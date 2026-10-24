# Provider reconnect policy

`src/provider-reconnect-policy.ts` is a transport/provider-independent policy utility; it is intentionally not wired into the server or any provider adapter.

## Integration seam

An eventual lifecycle owner (one instance per managed transport/account) should create `createReconnectLifecycle` with:

- `connect`: begin one connection attempt; synchronous throws and later socket close/error events must be translated by the owner into `failed()` (the helper does not observe sockets).
- `schedule(callback, delayMs)`: schedule the callback and return an idempotent cancellation function. The callback starts the next attempt via `connect`.
- On successful transport open, call `connected()` to reset the consecutive-failure count and cancel/invalidate any retry that was queued before the connection opened.
- On intentional shutdown, account disable/removal, or owner disposal, call `close()`; it cancels pending work and permanently prevents future starts. Create a new lifecycle for a later re-enable.

`start()` initiates the initial attempt immediately. `failed()` schedules at most one retry at a time. Delay is zero-based exponential (`baseDelayMs * 2^retryIndex`) capped before jitter; symmetric jitter is bounded by `jitterRatio` (default 20%). Inject `random` and `schedule` for deterministic tests. This module does not define retry classification, connection timeouts, socket disposal, or integration with current Reverse WebSocket ingress.
