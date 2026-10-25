# AOI implementation tracker

## Phase A — executable core
- [x] Reverse WS + HTTP events, normalize, memory dedup
- [x] HTTP API basics, guarded direct send
- [x] MCP stdio and HTTP read tools
- [x] migration schema foundation
- [x] PostgreSQL outbound idempotency: migration, store and send-runtime wiring in PostgreSQL mode; fixture tests cover claims/completions and pending/uncertain behavior (not exactly-once; live provider/database production qualification remains)
- [ ] Wire durable repository + migrations into runtime where not yet integrated
- [ ] CLI targeting API

## Remaining product work (do not claim complete)
- [ ] identity / provider capabilities / contact sync and target ambiguity
- [ ] production qualification of send/revoke and durable idempotency; reconcile pending/uncertain outcomes (no exactly-once guarantee)
- [ ] authenticated attachment retrieval route, upload/send; current `get_file` adapter and safe local retrieval are helper-only
- [ ] Inbox states, rules, watch, search, context and history reconciliation
- [ ] runtime-wired durable notification worker, batching/digests; queue store and `0011` migration exist but are not runtime-wired or live-DB-migration-tested
- [ ] production provider lifecycle integration; controller helper is not wired to managed transports
- [ ] UI, Redis queue, metrics, deployment smoke/integration tests

Current acceptance verification is fixture-level only. Production requires live OneBot integration tests and persistent database before send capabilities should be trusted.
