# AOI implementation tracker

## Phase A — executable core
- [x] Reverse WS + HTTP events, normalize, memory dedup
- [x] HTTP API basics, guarded direct send
- [x] MCP stdio and HTTP read tools
- [x] migration schema foundation
- [x] PostgreSQL outbound idempotency: migration, store and send-runtime wiring in PostgreSQL mode; fixture tests cover claims/completions and pending/uncertain behavior (not exactly-once; live provider/database production qualification remains)
- [x] Wire PostgreSQL message repository and migrations into server runtime when `DATABASE_URL` is configured; live end-to-end durability/restore qualification remains
- [x] CLI targeting API (read-only); unread command passes `unread=true` for Agent inbox unread state

## Remaining product work (do not claim complete)
- [x] Contact/group/member sync and contact search are wired to authenticated account admin API routes, with memory/PostgreSQL-backed contact storage and signed pagination cursors; provider contact-change event sync, contact-aware send routing, and live provider qualification remain open.
- [x] History reconciliation dry-run preview: bounded provider history fetch, comparison with local messages, existing/missing/duplicate classification, audit record; does not import or mutate messages, and runtime/provider qualification remains open.
- [x] Authenticated operator inspection of pending outbound idempotency records (bounded to 100; no automatic retry) and durable adjudication persistence/API are wired in server runtime when PostgreSQL is available. Adjudication appends operator evidence only; it does not change the send ledger, retry, or repair messages. PostgreSQL migration and live database/deployment behavior remain unqualified; no exactly-once guarantee.
- [ ] Production qualification of send/revoke and durable idempotency; any recovery workflow beyond inspection and append-only adjudication of evidence.
- [x] authenticated attachment retrieval route via OneBot `get_file`, with account permission, allowlist, sandbox and size controls (real provider E2E unverified)
- [x] attachment upload/send via authenticated API, with request idempotency and allowlisted file validation (NapCat upload supported; SnowLuma fails closed until verified; see `docs/attachment-upload.md`)
- [x] Inbox state: unread/seen, processed, and dismissed are separate Agent-side states (not QQ read state); API supports one state filter per request and individual processed/dismiss actions. Inbox UI provides state actions, mark-all-seen, and group names.
- [x] Inbox rules: authenticated API supports rule CRUD and applies configured rules during ingress; persistence is PostgreSQL-backed when configured and memory-backed otherwise. Runtime/provider/database production qualification remains outstanding. History reconciliation/audit helpers are implemented separately, but complete reconciliation workflow and production qualification remain open.
- [x] Notification queue: runtime queue/worker, failure inspection, manual retry, bounded outbox reconciliation, and opt-in bounded per-account digests are implemented; live PostgreSQL/CI and webhook delivery/restart recovery qualification remain.
- [x] authenticated failed-notification listing and explicit admin retry API, with audit record; retry is at-least-once and may duplicate a delivery whose remote outcome was ambiguous
- [x] runtime provider-session liveness: server sends WebSocket ping every 30 seconds, terminates after 10 seconds without pong; this detects dead sessions but cannot reconnect provider-initiated Reverse WS clients
- [ ] UI, Redis queue, metrics, deployment smoke/integration tests

Current evidence includes fixture tests and configured CI PostgreSQL integration coverage, but CI execution/live PostgreSQL queue migration and delivery have not yet been confirmed. No live provider send/attachment/webhook verification or backup/restore drill has been performed. Production qualification requires those checks before trusting the respective capabilities.
