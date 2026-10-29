# Provider lifecycle runtime integration design

## Current implementation (source-verified)

- `src/provider-lifecycle.ts` exports `createProviderLifecycle`, a transport-agnostic retry controller. It calls a supplied `connect(events)` once on `start()`, schedules retries only when the attempt reports `failed()`, resets retry backoff on `connected()`, and cancels a pending retry on `close()`. It does not own or close a transport and its source comment explicitly says it is not production transport wiring.
- `src/provider-reconnect-policy.ts` supplies exponential backoff with jitter (defaults: 500 ms base, 30 s cap, 20% jitter).
- `src/reverse-ws.ts:createManagedReverseWsClient` is the existing transport-owning wrapper. It tracks one active socket plus in-flight candidates, disposes stale attempts, closes replaced candidates, and closes active/pending sockets plus retry timer at shutdown. It is not called by runtime code; repository search finds only its definition and `tests/reverse-ws-lifecycle.test.ts` callers.
- `src/server.ts:startServer` creates a `Map<string, Peer>` and `RuntimeOneBotService`, then creates an HTTP server and a `WebSocketServer({ noServer: true })`. Its upgrade handler authenticates and accepts **inbound** provider connections at `/onebot/v11/ws[/<account>]`; it does not dial providers or create managed Reverse WS clients. On a second connection for an account it closes the old socket and replaces the peer. The socket close handler removes the peer only if that exact peer is still current, and resolves pending action calls as disconnected. Thus the external provider/client currently owns reconnect attempts; server-side lifecycle retries must not be added around each inbound socket.
- `RuntimeOneBotService` receives the shared peer map and uses an open peer socket for actions, with HTTP `action_url` fallback where supported. It neither creates nor closes sockets.
- Admin account create/update reloads configured accounts and closes/removes an existing peer for the changed account (`src/server.ts`, account routes); deletion similarly removes it. No runtime dial/reconnect follows these writes. A provider must reconnect to the listener itself.
- Runtime close in `src/server.ts` stops notification workers, closes peer sockets, closes the WebSocket and HTTP servers, and ends the DB pool. `src/main.ts` installs SIGINT/SIGTERM handlers that await `runtime.close()` and exit. There is no provider lifecycle handle in either place.

### Capability labels

- **Wired runtime behavior:** inbound Reverse WebSocket acceptance, account peer replacement/cleanup, action dispatch through the current peer (with supported HTTP `action_url` fallback), and shutdown of accepted peers.
- **Helper only:** `createProviderLifecycle` retry controller and `createManagedReverseWsClient` transport-owning wrapper. Their isolated tests establish helper behavior only; neither is instantiated by production startup, account CRUD, nor `Runtime.close()`.
- **Not implemented by these helpers:** account-scoped outbound dial configuration, persisted lifecycle ownership, runtime event publication, provider onboarding, or live-provider qualification. Do not describe the lifecycle as production reconnect support.

## Integration boundary and ownership

Do not attach `createProviderLifecycle` to the current inbound WebSocket `connection`/`close` events: retrying from the server would create a second connection initiator and duplicate the provider's own reconnect behavior. Do not create one managed client per consumer (`RuntimeOneBotService`, attachments, contacts, MCP); they already share the account peer map/service.

If a future runtime mode is introduced that actively dials a provider, make one account-scoped transport manager the sole owner of that outbound connection. It should own exactly one `createManagedReverseWsClient` (or equivalent lifecycle + socket owner) per enabled account, and publish only the current successful socket into the shared account peer registry. Action services continue to consume that registry and never create transports. Keep the existing inbound listener as a distinct mode; explicitly prevent the same account from being both actively dialed and externally connected unless a deliberate arbitration policy is implemented.

The account-scoped manager should be created once after final account configuration has been loaded (including DB-managed accounts), and started only for accounts whose transport mode requires an outbound dial. On account update/delete, stop and dispose the prior manager before replacing/removing its configuration; create/start a replacement only after persisted state and validation succeed. Shutdown should be idempotent: stop all managers first (cancel retries and close active/pending candidates), then close listener sockets/servers, await in-flight cleanup, then close the DB pool. Managers must not be started from HTTP request handlers on every request or from both `main.ts` and `startServer`.

For the current inbound-only mode, lifecycle integration is instead limited to deterministic peer cleanup and connection observability. Existing `startServer` owns accepted sockets and already handles peer replacement and removal. No retry controller should run there; document/configure provider-side retry separately.

## Proposed runtime wiring for a future outbound mode

1. Add a single registry in `startServer`, keyed by account ID, that owns manager handles and is the authority for start/stop. Construct it after account loading and service setup; inject the shared peer publication callback into the transport owner.
2. For each eligible account, manager `connect` creates a fresh candidate socket and reports `connected` only after the transport's real ready/authenticated condition. Report `failed` exactly once for each failed attempt (connect error, pre-ready close, or established socket close). On established close, clear the published peer only if it still refers to that socket, reject/settle pending calls, and request retry. Stale callbacks must never publish or remove a newer socket.
3. Publish a peer once on successful connection. On replacement, atomically switch the current peer before closing the prior socket; cleanup must use identity/generation checks. Do not allow multiple consumers to own the same socket or independent retry loops for one account.
4. Account update/delete: persist and validate first; stop old manager and await closure; remove old peer conditionally; then create/start the new manager only if still enabled and configured for outbound mode. Failed persistence leaves the old live manager untouched. Prevent late callbacks from an old manager from republishing after replacement.
5. Shutdown: set a runtime closing flag to reject new starts, close every manager (which cancels scheduled retries and closes active plus connecting sockets), await their shutdown promises, then close inbound peers/WebSocket server/HTTP server, stop background workers, and finally end the pool. Preserve the existing `Runtime.close()` idempotence contract.

This is a proposal, not current behavior; the existing `createManagedReverseWsClient.close()` is synchronous, so awaiting managers would require an explicit asynchronous disposal contract if transport close itself is asynchronous.

## Reconnect and ownership tests required before any outbound mode is called wired

- **Single owner:** starting runtime for one outbound-enabled account creates exactly one dialer; API/MCP/attachment/contact operations do not create additional dials. Repeated start or duplicate lifecycle events do not create parallel active attempts.
- **Failure and retry:** a failed dial schedules one retry using the shared backoff policy; running the scheduled callback creates one new candidate. Successful readiness resets the failure backoff. Verify failure callbacks emitted more than once schedule only one retry.
- **Established disconnect:** closing the active socket removes that exact peer, settles pending calls, schedules retry once, and a later successful attempt republishes the peer.
- **Stale attempt safety:** an older attempt's late ready/close/error callbacks cannot replace or delete a newer peer; stale candidates are closed exactly once.
- **Replacement/account edits:** updating account credentials/config stops the old manager before new dialing; deletion stops retries and leaves no peer; persistence failure does not tear down the working manager. Disabled accounts never start.
- **Shutdown:** close during scheduled retry cancels it; close during connection establishment closes the pending candidate; close with active socket closes it once; late callbacks do not restart or republish; repeated `Runtime.close()` is safe.
- **No mixed ownership:** inbound-only configuration never starts outbound dialers; if an outbound manager and inbound connection can coexist, a test must enforce the chosen explicit precedence/rejection policy.

Existing unit tests `tests/provider-lifecycle.test.ts` and `tests/reverse-ws-lifecycle.test.ts` exercise the controller/wrapper in isolation (including retry cancellation and stale callback handling). They do not prove runtime wiring, account mutation behavior, server shutdown integration, or a real provider connection; add the above runtime-level tests rather than treating those unit tests as integration coverage.

## Smoke verification and stop conditions

For current inbound-only mode, smoke-test in staging with a dedicated provider test account: connect one provider client, confirm authenticated peer availability and one harmless action, disconnect it, and confirm pending actions fail visibly and the peer is removed. Reconnect from the provider side and confirm the replacement peer serves subsequent actions. Change/delete the test account and verify the old peer is closed and cannot serve actions. On shutdown, verify the listener and accepted socket close cleanly. Record client/provider version, account mode, logs, and results; this is runtime smoke evidence, not broad provider qualification.

Stop/no-go if the wrong account or peer can receive an action, an old peer remains usable after replacement or account change, disconnect is reported as success, pending calls hang, secrets are logged, or shutdown leaves sockets/workers alive. Do not add a server retry loop to inbound connections as a workaround: that changes connection ownership and risks duplicate sessions. If an outbound mode is later added, it remains unqualified until the runtime-level ownership tests above and provider-specific real connection/disconnect/reconnect smoke pass for each supported provider/version.

The lifecycle controller and managed WebSocket wrapper remain **helpers, not wired features**, until startup, account mutation, peer publication, and shutdown own them end-to-end and tests exercise those runtime paths.

## Verification references

Facts above were checked against `src/server.ts` (startup, account mutation, upgrade/connection handlers and `Runtime.close()`), `src/main.ts` (signal shutdown), `src/runtime-onebot-service.ts`, `src/provider-lifecycle.ts`, `src/provider-reconnect-policy.ts`, `src/reverse-ws.ts`, and the two lifecycle test files. This document proposes no runtime code changes.