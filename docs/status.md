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
- 联系人/群/成员同步与搜索 API 已接线；联系人感知发送目标解析目前仅为未提交 helper，尚未接入发送 runtime。联系人变更事件同步及真实 provider 行为未验证。
- AI 分类入口、备份/恢复 runtime、联系人感知发送目标解析，以及部分附件上传/恢复端点仅存在于未提交 worktree helper/改动；均未完成生产 runtime 接线或部署验证。摘要和任务提取未实现。
- Append-only audit table access for the `aoi_app` role is applied on fresh installs and during upgrade migration `0008_legacy_account_ids.sql`.
- Sensitive admin operations are recorded for account CRUD, priority/watch-person CRUD, notification configuration/tests, inbox state changes, sends/revokes (including denied attempts), and inbound message ingestion. Validation/transport failures before provider actions are covered where applicable.
- 附件：基线 commit `8baa4a7` 已接线幂等附件发送 API；当前未提交 worktree 中上传适配器/API、上传策略及附件发送恢复 helper 均属未发布改动。需区分 runtime 接线与真实 provider 上传验证；备份/恢复 runtime 和 AI 分类入口也仅有未提交 helper，尚未接入应用 runtime。已认证 `get_file` 下载 API 在基线中 runtime-wired，但真实 provider E2E 未验证。
- Real QQ/provider end-to-end, security and load testing. Public Cloudflare reachability was checked during the latest inbox fix deployment; this does not replace ongoing production smoke checks.

This remains an Alpha / early-development project, not a finished or production-ready implementation.
