# Current implementation status

Agent OneBot Inbox remains an Alpha under active development, not the complete product in the supplied specification.

## Current implementation

- Multi-account validation; authenticated OneBot v11 HTTP Event and Reverse WebSocket ingress; deduplication.
- Normalized messages, inbox filters/pagination/context, and persistent Agent inbox state: unread/seen, processed, and dismissed are distinct from QQ read state. Authenticated API supports filtering by one state at a time and marking individual messages processed/dismissed; inbox UI includes state actions, mark-all-seen, and group names. These are inbox features, not provider-side QQ read operations.
- CLI `unread` sends the API's `unread=true` filter (default limit 50). This filters Agent inbox unread state, not QQ platform read state.
- Authenticated account CRUD; PostgreSQL encrypts transport tokens, memory mode is volatile. Account changes require reconnecting provider-side transports manually; management does not install/login to QQ.
- Contact/group/member manual sync, priority/watch rules, and PostgreSQL-backed Hermes notification queue/worker runtime wiring. Queue enqueues on inbound messages and a worker polls/delivers; live PostgreSQL migration/queue and real webhook/provider behavior remain unverified.
- MCP and read-only CLI surfaces.

## Still missing or not production-ready

- End-to-end provider onboarding, production transport lifecycle/reconnect integration, and verified NapCat/SnowLuma capability adapters. The lifecycle controller currently exists as a helper with fixture-level tests; it is not integrated into production transport ownership.
- PostgreSQL migrations run at startup and `PostgresMessageStore` is wired into the server runtime when `DATABASE_URL` is set. The latest production container reached healthy readiness with PostgreSQL connected; full provider round-trip and backup/restore are not verified. Outbound sends now use `PostgresOutboundIdempotencyStore` when PostgreSQL is configured, with migration `0010_outbound_idempotency.sql`; request claims/completions are durable only in PostgreSQL mode. Pending/uncertain outcomes block automatic retry and require reconciliation; this is not an exactly-once guarantee. Tests cover the service/storage behavior with fixtures, not a live provider/database deployment.
- Contact/group/member sync and contact search are implemented behind authenticated account admin API routes, with memory/PostgreSQL-backed storage and signed pagination cursors. Contact-change event sync, contact-aware send-route resolution, and real provider qualification remain unverified.
- AI classification, summaries, and task extraction; live validation of the runtime-wired durable notification queue/worker, including retry/restart behavior. Migration `0011_notification_queue.sql` and queue/worker are wired into runtime only when PostgreSQL is configured; live database migration and delivery are not verified. Opt-in bounded per-account notification digests are implemented, but live digest delivery is not qualified. PostgreSQL append-only delivery history is separately wired and exposed at authenticated `GET /api/admin/notification-deliveries`; it is not itself a queue.
- Append-only audit table access for the `aoi_app` role is applied on fresh installs and during upgrade migration `0008_legacy_account_ids.sql`.
- Sensitive admin operations are recorded for account CRUD, priority/watch-person CRUD, notification configuration/tests, inbox state changes, sends/revokes (including denied attempts), and inbound message ingestion. Validation/transport failures before provider actions are covered where applicable.
- Attachment upload/send, backup/restore, user roles, and full MCP operation coverage. Authenticated OneBot `get_file` retrieval route is runtime-wired with account permission, host allowlist, sandbox and size controls; real provider E2E remains unverified.
- Real QQ/provider end-to-end, security and load testing. Public Cloudflare reachability was checked during the latest inbox fix deployment; this does not replace ongoing production smoke checks.

This remains an Alpha / early-development project, not a finished or production-ready implementation.
