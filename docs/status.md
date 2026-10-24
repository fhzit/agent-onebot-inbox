# Current implementation status

Agent OneBot Inbox remains an Alpha under active development, not the complete product in the supplied specification.

## Implemented and locally verified

- Multi-account config validation; authenticated OneBot v11 HTTP Event and Reverse WebSocket ingress; event deduplication.
- Normalized messages, inbox filters/pagination/context, and Agent processed/dismissed state separate from QQ read state.
- Authenticated admin UI: account CRUD, encrypted account-token persistence, priority/watch-person controls, notification settings, test delivery, and read-only audit history.
- Priority rules and watched people persist through `PriorityStore` and affect new-message scoring.
- Contact sync: authenticated per-account manual sync of OneBot friend/group/member lists, PostgreSQL snapshot persistence with per-account isolation, sync timestamps, in-memory contact resolver refresh, and signed account-bound cursors for friend/group listing. Sync does not mark QQ messages read.
- Notifications can be configured for Hermes Generic V2, including priority threshold, opt-in preview, timeout, bounded retry count, and signed test delivery. Notification settings persist in PostgreSQL and the webhook secret is encrypted with `ACCOUNT_ENCRYPTION_KEY`. Ingress notification delivery is best-effort and not backed by a durable queue/ledger.
- PostgreSQL schema/migration runner and async message repository exist. Their unit/fixture coverage is not the same as validating the full live server runtime against PostgreSQL.
- MCP, read-only CLI, attachment path safety helpers, and conservative contact resolver foundations.

## Still missing or not verified

- Provider onboarding and transport lifecycle controls for NapCat/SnowLuma, Forward WS, and complete HTTP/Hybrid Action configuration; account CRUD does not implement reconnect/reprovision lifecycle.
- Send-route resolution through synchronized contacts; contact search/edit APIs and platform change/member-role event sync.
- AI classification, summarization, and task extraction providers/configuration.
- Notification batching, digests, durable queue, delivery log, and retry persistence.
- Full write-side audit coverage and append-only audit policy; current UI/API shows only existing audit rows.
- Attachment transfer, retention/allowlist controls, and end-to-end provider integration.
- Backup/restore, complete user/role management, full MCP tool coverage, production remote MCP lifecycle, production security/performance review, and real QQ/provider end-to-end verification.
- Production deployment of recent settings, server encryption-key provisioning, and live migration/application verification.

Database-backed settings require migrations to be applied deliberately before deployment. The webhook setting table is migration `0005_app_settings.sql`. Never infer runtime readiness from unit tests or a successful container build. Inbox processing never sets QQ read state.
