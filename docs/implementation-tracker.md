# AOI implementation tracker

## Phase A — executable core
- [x] Reverse WS + HTTP events, normalize, memory dedup
- [x] HTTP API basics, guarded direct send
- [x] MCP stdio and HTTP read tools
- [x] migration schema foundation
- [ ] durable repository + wiring
- [ ] CLI targeting API

## Remaining product work (do not claim complete)
- [ ] identity / provider capabilities / contact sync and target ambiguity
- [ ] replies, revoke, auditable writes, database transactions/idempotency
- [ ] attachment metadata/fetch/send sandbox
- [ ] Inbox states, rules, watch, search, context and history reconciliation
- [ ] Hermes and generic webhook notifier with HMAC and batching
- [ ] UI, Redis queue, metrics, deployment smoke/integration tests

Current acceptance verification is fixture-level only. Production requires live OneBot integration tests and persistent database before send capabilities should be trusted.
