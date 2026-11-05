# MCP account-entitlement integration design

## Current implemented boundary

MCP data tools are currently disabled on both transports. `createMcpService` advertises no `tools/list` capability and registers no tool callbacks; clients may receive MCP `Method not found` for `tools/list`. The shared HTTP bearer token authenticates transport access but does not identify an account principal; stdio likewise has no caller-bound entitlement. Tool arguments, configured accounts, and static advisory allowlists are not substitutes for principal authorization.

This is an intentional fail-closed behavioral regression: inbox, contacts, attachment, admin, advisory, status, and mutation tools are unavailable through MCP until a verified request/process principal with account grants is bound and every handler enforces that scope. Tests must assert absent tool methods/inventory rather than invoke legacy handlers or expect an empty successful listing. Unit tests of individual handler factories and standalone registration helpers may remain where they do not imply production registration. Do not re-enable individual data tools based only on explicit `account_id` inputs or transport authentication.

## Re-enablement requirements

Before exposing data tools, implement a trusted principal source for each transport, bind it safely to the relevant request/isolated server (never mutable shared state), and apply authorization to every read and mutation. Resolve ID-based resources to their owning account before returning or mutating them; constrain queries and bulk operations in storage. Keep HTTP bearer-only access tool-free. Add registration inventory coverage and adversarial tests for missing scope, cross-account access, and concurrent principal isolation.

---



These names come from all registration paths: direct registrations in `createMcpService`, plus the named tool arrays in `mcp-additional-tools.ts` and individual `register*Tool` functions. A tool may only be installed conditionally, as noted. Scopes below are proposed authorization vocabulary, not existing runtime behavior. All are account-data entitlements unless called out as global metadata.

| Potential tool(s) (currently not registered) | Data accessed / scope | Account binding in current schema | Proposed required scope |
|---|---|---|---|
| `inbox_list`, `inbox_summary`, `inbox_search` | Stored message query / summary (`store.query`, `summary`) | Optional `account_id`; omitted means potentially all accounts | `messages:read` for every account returned; summary without account must be computed only across authorized accounts |
| `message_get`, `message_attachments`, `inbox_state` | Message by ID (`store.get` / `state`) | `id` / `message_id`, no account | `messages:read`; resolve record first and authorize its owning account before returning data; same for attachment references |
| `conversation_context`, `conversation_history`, `extract_tasks_from_history` | Bounded context around message ID (`store.context`) | Message ID anchor, no account | `messages:read` on anchor account and every returned record; enforce same-account boundary; do not treat untrusted anchor ID as authorization |
| `conversation_history_preview` | Context around anchor, checks explicit account and conversation against anchor and filters results | Explicit `account_id`, conversation ID, anchor ID | `messages:read` on selected account plus anchor ownership checks; its input fence is not principal authorization |
| `inbox_state`, `mark_seen`, `mark_seen_all`, `mark_processed`, `dismiss` | Inbox state read/write; bulk operation may span accounts | State single tools use message ID; `mark_seen_all` has no account input | `messages:read` for state read; `inbox:state:write` for mutations. Add account scope to bulk operation and constrain mutations to authorized accounts. |
| `get_attachment` (only when attachment service supplied) | Provider fetch for explicit account/file; requires account permission `direct`, allowed local roots and size limit | Explicit account ID and provider file ID | `attachments:read` on that account, plus existing direct-permission, path/root/size and provider-host checks |
| `contacts_search`, `contacts_list`, `group_members` (only with `contactSearch`) | Cached contact/group/member data | Explicit account ID | `contacts:read` on that account |
| `admin_contacts`, `admin_groups`, `admin_health`, `admin_notification_status` (only with `adminHandlers`) | Account contacts, status/health, notification status and recent deliveries; handlers validate account existence and redact secret-looking keys | Explicit account ID | `operations:read` (or narrower `contacts:read`, `account:read`, `notifications:read`) on that account; redaction is not authorization |
| `ai_advisories_list` (only when enabled and store available) | Bounded advisory metadata | Explicit account ID checked against configuration allowlist | `advisories:read` on that account, in addition to feature/config enablement. Static `allowedAccountIds` is not caller entitlement. |
| `accounts_list` | Configured account metadata (ID, alias, self ID, provider, enabled and permission) | None | `accounts:discover`; return only entitled accounts, never use as proof of access |
| `service_status` | Global configured/enabled account counts and stored-message count | None | `service:status` (or treat as operator-only); avoid leaking global counts to ordinary account principals |

None of the tools listed above are currently registered by `createMcpService` or `createStdioMcpService`, regardless of optional dependencies. The table is a future inventory for authorization planning only. Standalone helpers may still be unit-tested, but they are not exposed through either production transport.

## Principal source by transport (proposed)

### HTTP `/mcp`

The current route in `src/server.ts` (and the standalone `src/mcp-http.ts`) validates `Authorization: Bearer` against a single configured API token. That authenticates possession of a shared secret, not a user/service identity with account grants. It does not currently build a principal. Keep this behavior as authentication only during migration; do not infer `sub` or `accountIds` from tool arguments or client-supplied headers.

For the target design, authenticate each HTTP caller using a verified identity source (for example, OIDC access token validation: signature/key rotation, issuer, audience, expiry and intended client). Map verified subject/client identity to server-managed account grants in the application database or a trusted authorization service. Derive `McpPrincipal` server-side from verified claims plus that grant lookup. A static service token can remain for a single-purpose deployment only if its server-side token record maps to explicit account IDs and scopes; a shared global token must not silently mean all accounts. Bind the principal to the MCP request/transport context, never to tool input.

### stdio

`StdioServerTransport` in `src/mcp.ts` does not provide a user authentication exchange; the current `startStdioMcpServer` uses config accounts and stores only. Treat stdio as a local deployment boundary, not as an implicit per-user principal. In an initial rollout, make allowed account IDs/scopes explicit server startup configuration, validate them against enabled managed accounts, and bind them to that process's service principal. Restrict process execution and secret/config access at the OS/container level. If multiple local users or agents share the process, require an authenticated local IPC/credential mechanism or run one isolated process per principal—do not grant every connecting MCP client all configured accounts by default.

## Staged migration

### Stage 0 — establish inventory and deny-by-default contract

1. Maintain a central registry mapping every proposed tool to one or more scopes and its account-resolution strategy; test registration-name coverage so newly added tools cannot skip policy.
2. Define a trusted principal structure with stable `sub`, account grants, scopes, and source/audit metadata. Fail closed for missing, malformed, disabled, or stale grants.
3. Preserve existing input schemas initially, but classify every tool as account-scoped, global operator metadata, or state-mutating. Add tests for unknown IDs and cross-account IDs.

Exit criterion: registry exactly covers all always-on and conditionally registered names. No tool is marked secure merely because its schema accepts account IDs.

### Stage 1 — transport principal binding, initially shadow mode

1. Introduce a request-scoped principal provider at the transport boundary. HTTP derives it from verified authentication and server-side grants; stdio derives a fixed process principal from explicit config.
2. Ensure each MCP request dispatch receives the correct principal, including concurrent HTTP requests and multiple transports. Do not store a mutable “current principal” on the shared `McpServer` singleton. If the SDK handler lacks safe per-request context, create an isolated server/handler per authenticated transport session or use an explicitly supported request-context mechanism.
3. In shadow mode, resolve resource accounts, calculate allow/deny and log decisions without changing results. Do not log message content, tokens, or sensitive identifiers beyond approved audit references.

Exit criterion: integration tests prove identities do not bleed across concurrent transports; shadow decisions align with expected grants.

### Stage 2 — enforce reads and remove implicit all-account access

1. For explicit account tools, check entitlement before store/provider access; retain existence and enabled checks but return non-enumerating errors where suitable.
2. For ID-only reads, resolve the record, derive its account server-side, authorize, and only then return payload. Context/history results must be filtered to the same authorized account (and conversation where applicable); do not rely solely on an authorized anchor.
3. For optional `account_id` list/search filters, bind query execution to the principal's allowed account IDs. If omitted, query only those IDs, not all rows. Extend store query APIs to accept an authorization predicate/allowlist rather than post-filtering an unbounded result page.
4. Make contact/admin/advisory tools use the same principal policy; existing handler existence checks, advisory allowlists, and safe JSON redaction remain defense-in-depth.
5. Restrict `accounts_list` to authorized discovery and `service_status` to an operator scope or safe per-principal aggregates.

Exit criterion: tests demonstrate denied accounts yield no data, including through omitted filters, anchor IDs, message IDs, attachments, and pagination edges.

### Stage 3 — enforce mutations and bulk operations

1. Gate `mark_seen`, `mark_processed`, and `dismiss` on `inbox:state:write` for the target message's owning account; separately allow `inbox_state` under read scope.
2. Change `mark_seen_all` to accept an explicit account or define it as an operation over exactly the principal's account grants. Apply the allowlist in the store mutation itself to avoid races or cross-account writes.
3. Audit each mutation with principal ID, tool, target account/resource reference, decision and outcome; exclude message bodies and credentials. Keep mutations idempotent where feasible and test repeated calls.

Exit criterion: unauthorized and cross-account mutations are rejected without changing rows; permitted mutations affect only entitled accounts.

### Stage 4 — remove compatibility bypasses and harden operations

1. Remove shadow mode and any legacy “authenticated means all accounts” behavior. Rotate shared API tokens and migrate clients to scoped identities or explicit service principals.
2. Require explicit stdio grants in production; document local-development defaults separately and make production startup fail if grants are absent.
3. Add periodic grant revocation/expiry handling, auditable policy changes, metrics for denied decisions (without high-cardinality sensitive labels), and startup checks that every registered tool is policy-covered.
4. Review provider attachment permission independently; account entitlement does not supersede direct permission, allowed roots, byte caps, or safe provider URL constraints.

## Enforcement rules and implementation notes

- Authorize on the server-derived account owning the resource, not an account ID supplied by the caller. Caller-supplied account IDs are selectors only.
- Apply query constraints in storage, before pagination and aggregation. Post-filtering can leak counts, miss authorized rows, or return sparse pages with misleading cursors.
- For `mark_seen_all`, global summary/status tools and any future multi-account tool, define whether policy is per-account or operator-wide; never let omitted scope imply unrestricted access.
- Fail closed on missing principal, missing scope, account disabled, mismatch between grant and managed account, invalid identity claims, or authorization backend failure.
- Distinguish transport authentication, account entitlement, tool-specific scope, and local resource controls (attachment roots/permissions). Passing one layer must not imply the others.
- Keep tool registration and authorization policy coupled through a coverage test; require that test for every newly registered MCP tool.

## Source-grounded observations

- `src/mcp.ts`: registers inbox, message, history, state, account/status tools; history and state operations often accept IDs without account scope. It wires optional contacts, additional tools, advisory list, and attachments.
- `src/mcp-http.ts`: bearer-token authentication only; standalone service currently uses in-memory `MessageStore`.
- `src/server.ts`: main `/mcp` bearer check, shared MCP service, attachment provider resolver restricted to enabled configured accounts and existing direct permission/root controls. A nearby comment states that there is no caller-to-account entitlement binding and advisory data is withheld from this route.
- `src/mcp-additional-tools.ts`: additional tools require explicit account and validate existence, but do not bind that account to a caller principal.
- `src/mcp-ai-advisories.ts`: static allowed-account list is checked, but it is not derived from the current caller.
- `src/mcp-account-authorization.ts`: helper functions already describe a fail-closed principal/account filter contract; they are not presently wired into transports or registered handlers.
- `src/mcp-main.ts`: stdio creates a service with config accounts and no principal; optional persistent stores do not add caller identity.
