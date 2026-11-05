# MCP authorization verification matrix

**Purpose:** executable acceptance checklist for authorization testing of every currently registered MCP tool and transport. This is a test plan, not evidence that authorization is implemented. Reconcile tool names with `src/mcp.ts`, `src/mcp-additional-tools.ts`, optional registrations, and `tests/mcp-tool-registration-inventory.test.ts` whenever tools change.

## Current boundary (do not mistake for authorization)

- **Main HTTP:** `/mcp` in `src/server.ts`, Streamable HTTP, authenticates a shared `API_TOKEN` on each POST. It does not establish a stable caller principal or bind that principal to account entitlements. Missing/invalid bearer is rejected before MCP dispatch. The main HTTP registration supplies contacts and attachment service; it does not supply admin handlers or advisory dependencies.
- **Standalone HTTP:** `src/mcp-http.ts`, Streamable HTTP, also checks the shared bearer token, but builds a bare `MessageStore` MCP service without optional contacts, attachments, admin handlers, or advisory dependencies. Authentication is not per-account authorization.
- **stdio:** `src/mcp-main.ts` / `StdioServerTransport`; there is no protocol-level caller identity. Runtime registers admin handlers; the default memory mode derives managed account records from configured accounts, while persistent mode uses account/contact/notification stores. Treat process isolation as deployment control, not a client principal.
- `src/mcp-account-authorization.ts` helpers are not wired to current transports/tools. Explicit account IDs, managed-account existence checks, direct attachment permission, allowed roots, and advisory allowlists are additional checks, not a principal grant. Advisories are not registered in standard HTTP or stdio. Do not mark any case PASS as account authorization until enforcement is wired and exercised through the real transport dispatch path.

## Test fixture and expected principals

Use isolated seeded data across three enabled accounts `A`, `B`, `C`, plus disabled account `D`; each has distinguishable messages, contacts, groups, attachments, status, and notification deliveries. Include a missing/deleted account and a resource ID that does not exist. Seed cross-account messages with same conversation IDs and adjacent timestamps to catch context leakage. Keep assertions on returned content, store/provider call counts, and mutation state.

For a target authorized design, use verified principals/grants:

| Principal | Account grants | Purpose |
|---|---|---|
| `pA` | A | Single-account positive and cross-account denial |
| `pAB` | A, B | Multi-account filtering and aggregation |
| `pNone` | none | Authenticated but unentitled |
| `pRevoked` | formerly A; now revoked | Revocation / stale-session denial |
| `pBad` | malformed or absent subject/grants | Fail-closed validation |
| operator `pOps` | explicit operator scope and configured grants | Global operational tools only where explicitly permitted |

Current HTTP bearer has no mapping to these principals and stdio has no such principal. Until that changes, rows requiring principal authorization are **NOT SATISFIED by current wiring**; record existing bearer/authentication and local tool behavior separately.

## Cross-cutting test axes (run for each applicable tool/transport)

| ID | Setup / attempt | Required result |
|---|---|---|
| X1 | No HTTP bearer; wrong bearer; malformed bearer; valid bearer | No-bearer/wrong/malformed rejected before MCP initialization or tool invocation (401); valid token authenticates only, and must not imply all-account entitlement. Verify standalone and main HTTP independently. |
| X2 | Authenticated principal absent, empty/malformed `sub`, missing/non-array grants, empty grants, unknown grant IDs | Deny all account data and mutations; no downstream store/provider call where authorization can be checked first. Never fall back to configured-all accounts. |
| X3 | Request account A / B / D / nonexistent under `pA` | A allowed only with required scope; B, disabled D, and nonexistent denied without data-dependent account enumeration. A supplied `account_id` is a selector, not proof. |
| X4 | Omit account selector on list, search, summary, bulk mutation | Operate only over principal-authorized accounts (e.g. A for `pA`; A+B for `pAB`), or reject if omission is ambiguous. Never mean all configured accounts. Apply scope in storage before limit, pagination, or aggregation. |
| X5 | ID-only message/resource belonging to A, B, D, or missing | Resolve owning account server-side; authorize before returning fields or derived data. Denials must not expose whether foreign IDs exist. |
| X6 | Revoke A grant between calls; expire identity; authorization backend errors | Next call fails closed; no stale positive cache beyond documented revocation bound. Backend failure denies. Verify a previously valid transport/session cannot continue reading or mutating after revocation policy requires denial. |
| X7 | Concurrent requests for `pA` and `pB` over shared server/HTTP service | No principal/context bleed; each result and mutation stays in its principal's grant set. Exercise concurrent separate HTTP transports and sequential reuse where supported. |
| X8 | Invalid tool arguments, oversized page limits, account ID with invalid chars, path separators in provider file ID | Schema/local validation rejects; no data/provider/mutation access. Keep errors non-enumerating. |
| X9 | Authorization denial and store/provider errors | No partial results or writes; redact credentials, tokens, webhook URLs, message bodies from logs and error payloads. Record an auditable decision without sensitive payloads. |
| X10 | Inventory comparison on every transport/configuration | Assert exact listed names against expected conditional registrations; every tool has a policy row. Unexpected/new tool is a failure, not silently untested. Test optional dependencies both absent and present. |

## Tool-by-tool authorization cases

In this table, `R(A)` means principal has account A and `messages:read`; `W(A)` means A and `inbox:state:write`. These are proposed verification scopes, not claims about existing runtime scopes. Additional narrower scopes may be adopted, but must be explicit and tested. All “deny foreign account” cases must verify both response and unchanged store/provider state.

| Tool (registration condition) | Class / resource binding | Required cases and expected authorization |
|---|---|---|
| `accounts_list` (always) | Account discovery; exposes ID, alias, self ID, provider, enabled, permission | `pA` sees only A or receives a deliberately minimized authorized view; `pNone` sees none/denied. Disabled D and B must not leak. `pOps` may see configured inventory only with explicit operator/discovery scope. Never use listing as entitlement. |
| `service_status` (always) | Global configured/enabled/message counts | Deny ordinary `pA`/`pNone`, or return strictly authorized per-principal aggregates with no global counts. Global counts only for explicit operator scope. Test count differences do not disclose other accounts. |
| `inbox_list` (always) | Message read; optional `account_id`, filters and pagination | `R(A)` with A filter returns A only; B/D filter denied; omitted filter is constrained to A. `pAB` omitted filter may return A+B only, with pagination/total counts scoped before paging. |
| `inbox_search` (always) | Message-text search; optional account and pagination | Same account cases as `inbox_list`; no foreign text/snippets, counts, or cursor leakage. Query execution must be scoped before search/pagination. |
| `inbox_summary` (always) | Account aggregates; optional account and timestamp | Explicit/omitted account obeys grants; totals and time-window aggregates include only authorized accounts. Deny disabled/foreign account. |
| `message_get` (always) | Message by `id`, account inferred from record | A record allowed for `R(A)`; B/D record denied with non-enumerating result; missing ID does not reveal existence. Check authorization before serializing message/body/metadata. |
| `message_attachments` (always) | Attachment references via `message_id` | Require `R` on owning message account; deny foreign/disabled/missing. Ensure `remote_reference`, provider file ID, and filename are not leaked on denial. This tool does not fetch provider bytes. |
| `conversation_context` (always) | Context by `message_id`, `before`, `after` | Require `R` on anchor's owning account and scope every returned row to authorized account/conversation. Seed foreign account messages in same conversation/time range; none may appear. |
| `conversation_history` (always) | History by message anchor (see `src/mcp-history.ts`) | Require `R` on anchor account; returned history stays in authorized account and conversation. Cross-account adjacent records and IDs denied/filtered; verify bounds do not bypass scope. |
| `conversation_history_preview` (always) | Explicit `account_id`, `conversation_id`, `anchor_message_id` | Require `R` for account and server-side ownership match for anchor/account/conversation. Mismatched or foreign anchor returns no messages and no existence leak. Every returned message matches the authorized account and conversation, including pagination/window edges. Explicit account input alone is insufficient. |
| `extract_tasks_from_history` (always) | Derived task extraction from message history | Treat derived output as message content: require `R` on anchor/account and authorize all source rows; no task, quote, or participant from foreign rows. Test empty/missing/foreign anchor and mixed-account context. |
| `inbox_state` (always) | State read by `message_id` | Require read scope on message's owning account. Foreign/missing ID returns no state; must not reveal processing/dismissal status. |
| `mark_seen` (always) | Mutation by `message_id` | Require `W(A)` on owning account; `R(A)` alone and any B/D grant deny. Assert exactly target row changes; QQ/provider read state remains untouched. Repeat call tests idempotent behavior. |
| `mark_seen_all` (always) | Bulk mutation; no account input in current schema | Require explicit account selector or constrain atomically in storage to all and only grants. `pA` changes no B/D rows; `pNone` changes none. Reject ambiguous global operation absent scoped semantics. Verify concurrent insertion/race does not cross grants. |
| `mark_processed` (always) | Mutation by `message_id` | Require `W` on target account. Read-only scope denied; foreign/missing ID unchanged. Assert only intended agent state changes and QQ status does not. |
| `dismiss` (always) | Mutation by `message_id` | Require `W` on target account. Read-only scope denied; foreign/missing unchanged. Assert only intended target changes; no provider-side QQ read mutation. |
| `contacts_search` (with `contactSearch`) | Contacts read, explicit account | Require contact-read grant for account A; deny B/D/unknown despite store availability. Check query, result count, and pagination do not expose other accounts. |
| `contacts_list` (with `contactSearch`) | Contacts read, explicit account | Same account authorization; verify complete lists and sync metadata are account-fenced. |
| `group_members` (with `contactSearch`) | Group/member read, explicit account/group | Require grant for account owning group; reject foreign group/account mismatch and unknown group without member leakage. |
| `admin_contacts` (with `adminHandlers`; stdio runtime) | Operational contacts summary, explicit account | Require explicit account-level operations/contacts scope; managed-account existence check is not authorization. Deny foreign/disabled/unknown; verify no raw secrets or other-account data. |
| `admin_groups` (with `adminHandlers`; stdio runtime) | Operational groups summary, explicit account | Same; test foreign account, disabled account, unknown account and redaction. |
| `admin_health` (with `adminHandlers`; stdio runtime) | Account operational status, explicit account | Require account/status scope; deny enumeration of account existence/status. Ensure disabled account is denied even if present in managed store. |
| `admin_notification_status` (with `adminHandlers`; stdio runtime) | Notification configuration summary and recent deliveries, explicit account | Require notification/operations read scope. Verify deliveries filtered to selected authorized account; no webhook URL, token, secret, or foreign delivery. Current safe JSON redaction is defense-in-depth, not authorization. |
| `get_attachment` (only with attachment service; main HTTP registration) | Provider fetch, explicit account and file ID | Require `attachments:read` on account, then independently enforce account exists/enabled, direct permission, allowed provider host/root, byte cap, and valid file ID. Denied account must cause zero provider fetch. Test permission `indirect`, path-like ID, out-of-root result, oversized file, and provider failure. No base64 bytes on denial. |
| `ai_advisories_list` (only explicit `aiAdvisories` dependency) | Advisory metadata read; explicit account plus static allowlist | Require caller principal grant and advisory-read scope in addition to feature eligibility/config allowlist; test allowlisted-but-unentitled, entitled-but-not-allowlisted, revoked grant, disabled account, backend failure, pagination and metadata-only output. Confirm absent in standard HTTP/stdio inventories until identity binding exists. |

## Transport execution matrix

| Transport/runtime path | Authentication / principal cases | Inventory and invocation coverage |
|---|---|---|
| Main `POST /mcp` (`src/server.ts`, Streamable HTTP) | Missing/invalid bearer => 401 before MCP. Valid shared bearer => MCP auth only; test all principal/account rows as denied/unimplemented until caller-to-account binding exists. Test authorization remains per request under concurrent transports. | Always-on tools + contacts trio + `get_attachment`; no admin tools or `ai_advisories_list` under current constructor arguments. Exercise initialize/list/call through HTTP SDK client, not only handler helpers. |
| Standalone `POST /mcp` (`src/mcp-http.ts`, Streamable HTTP) | Independently test missing/invalid/valid bearer. Valid token must not be treated as per-user grant. Same fail-closed target cases; currently no principal. | Bare service inventory: always-on tools; no contacts, attachments, admin, or advisory tools. Verify exact list and HTTP transport invocation. |
| `aoi mcp` / `startStdioMcpServer` (stdio) | No MCP caller authentication. Verify no assumption that local client identity equals configured account authorization. Target deployment must use isolated process with explicit fixed grants or trusted local auth; absent/malformed grants deny. | Runtime includes always-on + admin tools; persistent vs memory store mode should have same authorization policy. No contacts-search trio, attachment, advisory under current factory wiring. Use actual stdio subprocess/client integration for acceptance; in-memory transport tests are unit coverage only. |
| `createMcpService` with optional dependencies (test harness / future wiring) | Inject principal through trusted request context, never mutable shared server state or tool arguments. Test all principal states concurrently. | Exercise each conditional registration present/absent: contacts trio, four admin tools, `get_attachment`, `ai_advisories_list`; inventory must match dependencies exactly. |

## Evidence and completion record

For each run record commit, exact command, environment/config mode, transport, tool name, principal/grants, account/resource fixture, expected and actual response, store/provider call count, mutation diff, and pass/fail. Separate unit/helper tests, in-memory MCP tests, real HTTP/stdio transport tests, database/provider integration, and deployed-image qualification. Do not claim end-to-end authorization from helper tests or a valid bearer check alone.

**Acceptance gate:** inventory coverage is exact for every runtime path; every account-bearing read, derived result, mutation, aggregate, and optional tool has a passing allow and deny case through its actual transport; missing identity/grant, revocation, disabled accounts, backend failures, cross-account IDs, pagination/aggregation, and concurrent requests fail closed; no unauthorized read/write reaches the underlying store/provider. Until these gates pass, account-level MCP authorization remains unverified and advisory registration stays disabled.
