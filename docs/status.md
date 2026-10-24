# Current implementation status

Agent OneBot Inbox remains an Alpha under active development, not the complete product in the supplied specification.

## Current implementation

- Multi-account validation; authenticated OneBot v11 HTTP Event and Reverse WebSocket ingress; deduplication.
- Normalized messages, inbox filters/pagination/context, Agent processed/dismissed state separate from QQ read state.
- Authenticated account CRUD; PostgreSQL encrypts transport tokens, memory mode is volatile. Account changes require reconnecting provider-side transports manually; management does not install/login to QQ.
- Contact/group/member manual sync, priority/watch rules, and best-effort Hermes webhook notifications.
- MCP and read-only CLI surfaces.

## Still missing or not production-ready

- End-to-end provider onboarding, transport lifecycle/reconnect, and verified NapCat/SnowLuma capability adapters.
- PostgreSQL migrations run at startup and `PostgresMessageStore` is wired into the server runtime when `DATABASE_URL` is set. The latest production container reached healthy readiness with PostgreSQL connected. This is not yet a full provider end-to-end or backup/restore verification.
- Send-route resolution, contact search/edit and provider contact-change events.
- AI classification, summaries, and task extraction; durable notification queue, batching/digests, delivery history.
- Complete write audit, attachment upload/download, backup/restore, user roles, and full MCP operation coverage.
- Real QQ/provider end-to-end, security and load testing; deployment hardening and public reachability still need validation.

This remains an Alpha / early-development project, not a finished or production-ready implementation.
