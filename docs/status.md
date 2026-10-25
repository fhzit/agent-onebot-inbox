# Current implementation status

Agent OneBot Inbox remains an Alpha under active development, not the complete product in the supplied specification.

## Current implementation

- Multi-account validation; authenticated OneBot v11 HTTP Event and Reverse WebSocket ingress; deduplication.
- Normalized messages, inbox filters/pagination/context, Agent processed/dismissed state separate from QQ read state.
- Authenticated account CRUD; PostgreSQL encrypts transport tokens, memory mode is volatile. Account changes require reconnecting provider-side transports manually; management does not install/login to QQ.
- Contact/group/member manual sync, priority/watch rules, and best-effort Hermes webhook notifications.
- MCP and read-only CLI surfaces.

## Still missing or not production-ready

- End-to-end provider onboarding, production transport lifecycle/reconnect integration, and verified NapCat/SnowLuma capability adapters. The lifecycle controller currently exists as a helper with fixture-level tests; it is not integrated into production transport ownership.
- PostgreSQL migrations run at startup and `PostgresMessageStore` is wired into the server runtime when `DATABASE_URL` is set. The latest production container reached healthy readiness with PostgreSQL connected; full provider round-trip and backup/restore are not verified. Outbound sends now use `PostgresOutboundIdempotencyStore` when PostgreSQL is configured, with migration `0010_outbound_idempotency.sql`; request claims/completions are durable only in PostgreSQL mode. Pending/uncertain outcomes block automatic retry and require reconciliation; this is not an exactly-once guarantee. Tests cover the service/storage behavior with fixtures, not a live provider/database deployment.
- Send-route resolution, contact search/edit and provider contact-change events.
- AI classification, summaries, and task extraction; notification batching/digests and a production-wired notification worker. `PostgresNotificationQueue` and migration `0011_notification_queue.sql` provide a queue storage/helper slice only: it is not runtime-wired, and migration `0011` has not been tested against a live database. A PostgreSQL append-only notification delivery history is available via `PostgresNotificationDeliveryStore`, wired to message ingress and exposed through authenticated `GET /api/admin/notification-deliveries`. It records only event/account/message identifiers, outcome, HTTP status, and sanitized generic errors; it never stores webhook payload, URL, or secret; this history is separate from the new queue slice.
- Append-only audit table access for the `aoi_app` role is applied on fresh installs and during upgrade migration `0008_legacy_account_ids.sql`.
- Sensitive admin operations are recorded for account CRUD, priority/watch-person CRUD, notification configuration/tests, inbox state changes, sends/revokes (including denied attempts), and inbound message ingestion. Validation/transport failures before provider actions are covered where applicable.
- Attachment API/upload/download route, backup/restore, user roles, and full MCP operation coverage. OneBot `get_file` adaptation and sandboxed local-file retrieval helpers exist with fixture tests, but no authenticated retrieval route is exposed.
- Real QQ/provider end-to-end, security and load testing. Public Cloudflare reachability was checked during the latest inbox fix deployment; this does not replace ongoing production smoke checks.

This remains an Alpha / early-development project, not a finished or production-ready implementation.
