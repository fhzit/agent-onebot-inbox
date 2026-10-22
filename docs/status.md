# Current implementation status

Agent OneBot Inbox is in active incremental development. This repository is not yet the complete product described in the supplied specification.

## Implemented and locally verified

- Multi-account config with account/self-ID validation; authenticated HTTP Event and OneBot v11 Reverse WS ingress.
- Reverse WS shared-route identity resolution, action-response/event echo distinction, basic private/group sends, and in-memory dedup/idempotency.
- Normalized messages and segment preservation; rule-based priority scorer is injectable into server start and applied to both HTTP and Reverse WS message ingress. User rule persistence/configuration is not implemented.
- In-memory Inbox state: Agent seen/processed/dismissed is distinct from QQ read; this state is lost on restart.
- In-memory Inbox query supports account, type, sender, priority, at_me, keyword, since/until and offset/limit, returning total/has_more. MCP inbox list/search use this same query. This is not PostgreSQL FTS.
- MCP conversation context is target-message centered with before/after window; CLI is a read-only authenticated API client.
- PostgreSQL migration runner/schema and an async `PostgresMessageStore` repository have fixture/unit coverage. API runtime remains in-memory; migration application and DB failure modes are not live-verified.
- Attachment metadata helpers and local file-root allowlist/symlink/size checking; no provider download/upload action implemented.
- Account-scoped contact cache shape and conservative resolver: exact QQ ID or exact nickname/remark/card matching; ambiguous matches return every candidate. This is a foundation only; no contact synchronization or send-route integration exists.

## Still missing or not verified

- Runtime PostgreSQL wiring for messages/state, Drizzle migrations/integration tests, Redis/BullMQ queues.
- Provider adapter capability layer and actual NapCat/SnowLuma compatibility, Forward WS and complete HTTP/hybrid Action transports.
- Contacts/groups/member sync and persistence remain absent; resolver/cache are in-memory foundations and not wired to sends.
- Self-message revoke is available at the authenticated API route over Reverse WS; HTTP Action revoke and durable action audit are not implemented.
- Reply, attachment transfer, durable audit trail, atomic external action idempotency.
- Persisted priority/watch rules, AI classification/task extraction, notification aggregation/digest. A standalone injectable `AgentNotifier` and Hermes Generic V2 signed webhook client now exist with compact allowlisted payload, timeout, and unit coverage; not wired into ingress and no external webhook call has been made. Hermes V2 uses `X-Webhook-Timestamp` and `X-Webhook-Signature-V2` over `<timestamp>.<body>` as HMAC-SHA256 hex. Runtime configuration, endpoint lifecycle, retries, and delivery integration remain unimplemented.
- Full MCP tool surface, production-ready remote MCP lifecycle, WebUI, Docker end-to-end smoke, backup/restore, 100k-message performance and security review.

Run `npm test`, `npm run typecheck`, `npm run build`. Fixture tests do not establish live PostgreSQL, Redis or QQ provider compatibility.
