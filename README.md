# Agent OneBot Inbox

> 多 QQ 账号 OneBot 收件箱与 AI Agent 接入层。把私聊、群聊和 Agent 工具接入同一个可查询的 Inbox。

**当前状态：早期开发版 / 不适合生产运行。** 账号管理可保存 QQ 账号的 OneBot 配置，但不能替你安装 NapCat/SnowLuma 或登录 QQ；消息运行时目前仍以内存为主，重启会丢失消息。项目没有完成真实 QQ 端到端验收。请勿用于无人值守生产消息处理。

[项目状态](docs/status.md) · [API](docs/api.md) · [安全说明](docs/security.md) · [验证记录](docs/validation.md) · [贡献指南](CONTRIBUTING.md)

## 项目目标

Agent OneBot Inbox 不是一个普通 QQ 自动回复机器人。它的目标是为多个 OneBot 账号提供统一的消息收件箱与 Agent 操作入口：先安全地接收、归一化和查询消息，再逐步扩展到摘要、规则、附件和受控操作。

```text
NapCat / SnowLuma
        │ OneBot v11 events / Reverse WebSocket
        ▼
  Inbox API + normalizer ── MCP / CLI ── AI Agent
        │
        └── 当前 runtime store：PostgreSQL（配置 DATABASE_URL 时）；否则内存（非持久化）
```

核心模型按账号隔离。账号或联系人目标不明确时不应猜测；Agent 处理状态与 QQ 平台已读状态分开。

## 当前实现

- 多账号配置；账号 ID 与 QQ `self_id` 校验。
- OneBot v11 HTTP Event 与 Reverse WebSocket 事件入口；共享 WS 入口在多账号场景需要可识别的 `self_id`，不做账号猜测。
- 私聊/群聊发送基础路径、Reverse WS action echo 关联，以及已知本人消息的受限撤回 API。写操作需要认证、显式账号，并受账号权限控制。
- 消息归一化、未知 CQ segment 保留、事件去重；基础优先级评分。
- Inbox 查询过滤与分页、上下文查询、Agent 处理/忽略状态。读取和更新 Agent 状态不会触发 QQ 标记已读。
- MCP TypeScript SDK（stdio 与 Streamable HTTP）、只读 API CLI。
- PostgreSQL schema、migration runner 和 runtime message/Inbox repository 已接线；当前生产容器已通过数据库连接 readiness。备份恢复及真实 provider 行为仍未验证。
- Hermes Generic V2 通知能力使用有界同步重试、尽力投递；新增 PostgreSQL 通知队列存储与 migration 尚未接入 runtime，不能视为已启用的持久队列。
- PostgreSQL outbound idempotency 已接入发送 runtime（仅 PostgreSQL 模式）；pending/uncertain 请求会阻止自动重试，但不提供 exactly-once 保证。生产/live-provider 行为尚未验收。
- Provider lifecycle controller 与 OneBot `get_file` 适配、安全本地附件检索 helper 有实现及 fixture 测试；前者未接入生产传输，后者没有 authenticated API route。

详见[实现状态与未完成项](docs/status.md)。这不是 NapCat/SnowLuma 完整适配声明；各 provider 的真实兼容性尚未实测。

## 快速开始（本地开发）

### 环境要求

- Node.js 24 或更新版本
- npm
- NapCat/SnowLuma OneBot v11 配置（仅在做真实连接测试时需要）

```bash
git clone https://github.com/fhzit/agent-onebot-inbox.git
cd agent-onebot-inbox
npm ci
cp .env.example .env
```

编辑 `.env`：设置足够随机的 `API_TOKEN`，并通过 `ACCOUNTS_JSON` 配置账号。默认权限应保持 `readonly`：

```dotenv
HOST=127.0.0.1
PORT=8080
API_TOKEN=替换为独立的高熵随机密钥
ACCOUNTS_JSON='[{"id":"main","alias":"主号","self_id":"12345678","provider":"napcat","access_token":"替换为另一个独立密钥","permission":"readonly"}]'
```

`ACCOUNTS_JSON` 是 JSON 数组；账号必须有唯一 `id`、`self_id`、`alias` 和 `provider`。每个启用的账号应配置独立的 `access_token`。不要把真实密钥提交到 Git、日志、Issue 或聊天记录。

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

服务默认监听 `127.0.0.1:8080`（本地开发示例）。`GET /health` 是 liveness 检查；`GET /ready` 会反映当前持久化能力受限的状态。API 调用使用：

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:8080/api/accounts
```

### OneBot 连接

- Reverse WebSocket 共享入口：`ws://<host>:8080/onebot/v11/ws`
- 显式账号入口：`ws://<host>:8080/onebot/v11/ws/<accountId>`
若部署在另一个域名或容器网络，将 `wss://<your-inbox-host>` 换成服务可达地址。将同一个高熵令牌配置给 provider 的 OneBot Reverse WS 客户端和 Inbox 账号 `access_token`。`self_id` 是登录 QQ 后 OneBot 上报的 QQ 号。账号保存后，需在 provider 侧连接到该地址；连接成功才开始收事件。

公网部署前必须自行配置 TLS、反向代理访问控制、网络隔离和速率限制。请先用只读账号和测试环境验证连接，不要把 API 或 OneBot 入口裸露到公网。

## API、MCP 与 CLI

主要 API 路由包括 `/health`、`/ready`、`/metrics`、`/api/accounts`、`/api/messages`、`/api/summary`、发送/撤回及 Agent Inbox 状态更新。完整字段、鉴权和限制见 [API 文档](docs/api.md)。

MCP：

```bash
npm run mcp       # stdio transport
npm run mcp:http  # Streamable HTTP 服务
```

CLI 连接已运行的 API，不会创建本地独立消息库：

```bash
export AOI_API_URL=http://127.0.0.1:8080
export AOI_API_TOKEN="$API_TOKEN"
npm run aoi -- accounts
npm run aoi -- recent --account main --limit 20
npm run aoi -- summary --since 2026-10-20T00:00:00Z
npm run aoi -- search 报名 --account main
```

当前 CLI 搜索仅在 API 返回的最多 200 条记录中做本地子串筛选；`unread` 命令当前不能视为可靠的持久未读过滤。不是 PostgreSQL 全文搜索。

## Management console

- In the admin UI, open **设置 → 账号** and choose **添加账号**. Enter a unique internal ID, display name, your QQ `self_id`, provider (`napcat` or `snowluma`), and the OneBot access token. Keep permission at **readonly** until you intentionally enable sending. Enable the account only after its OneBot endpoint is reachable. For NapCat/SnowLuma, configure a Reverse WebSocket client targeting `wss://<your-inbox-host>/onebot/v11/ws/<account-id>` with the same access token; do not expose an unauthenticated OneBot endpoint publicly. Creating an account does not install or log in to QQ for you.
- If managing outside the UI, use authenticated `POST /api/admin/accounts` with `{id,alias,self_id,provider,access_token,permission,enabled,action_url?}`; omit secrets from logs and shell history. PostgreSQL mode encrypts account tokens with `ACCOUNT_ENCRYPTION_KEY`; admin reads redact secret values.
- Sensitive admin actions are written to the PostgreSQL audit table when configured; the read-only API is `GET /api/admin/audit`. Memory mode responds with `503 AUDIT_UNAVAILABLE`.
- Notification settings support a Hermes Generic V2 webhook, priority threshold, optional message preview, timeout/retry bounds, and a test action. Secrets are encrypted with the runtime `ACCOUNT_ENCRYPTION_KEY`; delivery uses bounded synchronous retries and is best-effort (the durable queue/delivery ledger is not wired yet).
- Account token values are write-only and never returned by management APIs; PostgreSQL mode encrypts them with AES-256-GCM using the externally supplied `ACCOUNT_ENCRYPTION_KEY` (base64-encoded 32 bytes). Keep this key in the protected runtime environment and back it up separately; losing it makes stored account tokens unrecoverable. Memory mode is volatile. The admin UI keeps its API token in tab memory only. In-memory settings disappear on process restart.
- The admin page build parses inline JavaScript with Node during typecheck/build; tests extract the served HTML and verify script syntax.

## Still missing or unverified

- Full NapCat/SnowLuma onboarding, provider capability compatibility, and automatic transport lifecycle/reconnect.
- Contact-aware send-route resolution, contact search/edit, and contact change/member-role event sync.
- AI classification, summaries, and task extraction.
- Runtime-wired durable notification queue/worker, batching/digests, and queue retry lifecycle. Queue store/helper and migration `0011_notification_queue.sql` exist, but are not runtime wired and migration `0011` has not been tested against a live database. The separately wired delivery history is not a queue.
- Audit rows are written to PostgreSQL for sensitive admin actions; API exposure remains read-only. The application role cannot update/delete/truncate audit rows. This does not protect against database-owner tampering, and deployment currently uses a shared application DB role; an independently administered audit sink and retention policy are not implemented.
- Authenticated attachment retrieval route/upload, backup/restore drill, user-role management, and full MCP tools/remote transport lifecycle. The `get_file` adapter and sandboxed local-file retrieval helper are not exposed through an authenticated route.
- Real QQ/provider end-to-end, security/load tests, and publicly reachable Cloudflare route validation.

This is still Alpha, not a complete product or production-ready service.


The GitHub Actions workflow tests pull requests and builds the container image without publishing it. Pushes to `main` publish `ghcr.io/fhzit/agent-onebot-inbox:main`; version-tag pushes (`v*`) publish the corresponding version tag. The workflow also publishes branch/tag and `sha-...` tags for pushed refs. GHCR packages may initially be private: set package visibility to **Public** in the package's GitHub settings after its first successful push if unauthenticated pulls are intended. `GITHUB_TOKEN` can publish only with repository Actions package-write permission and package access; it does not make package visibility public automatically.

The image is an early-development build, not a production deployment promise. Compose's PostgreSQL is not currently used by API runtime for message storage. Review the Docker configuration and use test data before running it.

## 数据与安全边界

- 消息写入 PostgreSQL 持久化；已用生产容器验证 ready/DB connected，尚未做实际 QQ 入站与读回闭环验证。
- PostgreSQL migration/runtime wiring is in place and production readiness returned database-connected. A full backup/restore drill, live QQ ingest/readback round trip, and retention/recovery proof remain outstanding.
- 发送需要 API 鉴权、显式账号和明确目标；账号默认应为 `readonly`。生产环境的授权策略、并发幂等、审计日志和恢复机制尚不完整。
- 撤回仅允许对当前内存库中已知的本人发出消息操作；撤回记录没有持久审计。
- 附件仅有元数据/本地路径安全辅助函数，没有完整 OneBot 下载、上传和服务 API。
- 目前没有真实 QQ/NapCat/SnowLuma 端到端验证，不保证 provider 特性兼容。

上线前请逐项评估[安全说明](docs/security.md)和[当前状态](docs/status.md)。不要将测试通过或依赖审计无漏洞等同于生产就绪。

## 开发与验证

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

测试使用 fixtures/mocks；这些检查不证明真实 QQ/provider、数据库、Redis、容器编排或外部 Webhook 已经联通。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图（概览）

- 完成 PostgreSQL 持久化的生产验证，并测试迁移、备份与恢复；outbound idempotency 当前已在 PostgreSQL send runtime 接线，但不保证 exactly-once。
- 建立 provider capability/adapter 层并对 NapCat、SnowLuma 做真实兼容性验证。
- 补齐 Forward WS、HTTP Action、联系人与历史同步、附件传输和持久化审计。
- 完善可恢复的队列、通知/Webhook 生命周期、CLI 未读语义与 Web UI。
- 增加受保护的 CI、镜像构建、部署与端到端验收。

GHCR CI 镜像地址（推送成功后）：`ghcr.io/fhzit/agent-onebot-inbox:main`。

## 许可证

MIT，见 [LICENSE](LICENSE)。