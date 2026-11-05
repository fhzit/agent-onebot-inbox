# AI advisory acceptance and rollout gates

**Current disposition: NOT ACCEPTED for default product use or deployment.**

## Current implementation snapshot (source, not deployment)

**Status: conditionally wired in source; not deployed or production-qualified.** The ordinary entry point supports explicit configuration via `AI_ADVISORIES_ENABLED=true`; it requires the HTTPS classifier endpoint/model, account allowlist, labels and `DATABASE_URL`. The admin UI calls the authenticated, account-fenced Node route. Advisory reads are not exposed through main HTTP or stdio MCP because no caller-to-account entitlement binding is established. Migration 0014 has not been run against real PostgreSQL; its composite unique key enables the account/message FK and incurs a table scan/lock whose production impact is unqualified. Configuration is operator-controlled, not a user-consent lifecycle. Production rollout is not accepted until DB/provider/deployment gates pass.

**Readiness note:** The server source includes authenticated retention preview/apply routes and operator UI. These are source-wired but not browser/deployment-qualified; tokens are process-local, audit actor is generic `admin`, there is no scheduler, and deleting advisory metadata does not delete parent messages or their backups. Migration 0015 requires role `aoi_app` to exist and fails closed if absent. Its direct ACL does not constrain table owners, superusers, or inherited role memberships; the production role/ownership setup is not yet qualified.


| Component | Checked-out source boundary | Not established |
|---|---|---|
| Classification and persistence | Conditional path in `startServer`: enabled account allowlist + newly inserted message invokes classification/persistence on HTTP and reverse WebSocket ingress; store accepts metadata only. `src/main.ts` now opts into this path only when `AI_ADVISORIES_ENABLED=true` and required classifier/database settings are present. | Default configuration remains disabled; startup wiring is source-tested, not proven against a real provider or database. Operator configuration is not user-level consent. |
| Schema/store | Migration `0014_ai_advisories.sql` defines metadata fields, account/message constraints, index and app-role grants. Migration 0003 converts runtime account/message IDs to `text`, matching these FKs. Store uses account-scoped composite keyset cursor (max 100). | Not run against real PostgreSQL; lock/scan impact for the `(account_id,id)` unique constraint and production role grants/ownership remain unqualified. |
| HTTP route | Node server exposes authenticated `GET /api/ai-advisories?account_id=...`, checks enabled store and account allowlist, and returns composite pagination cursor. `src/main.ts` supplies API config only when `AI_ADVISORIES_ENABLED=true`. | Separate Fastify helper has a distinct route and is not registered in the Node server; its cursor now matches the store's `(created_at,message_id)` ordering. No deployed DB/auth configuration qualified. |
| Admin UI | Panel is embedded in the admin template and generated page; it calls `/api/ai-advisories?account_id=…` using the token-bearing API helper, populates the account selector, renders safe metadata as text, and supports composite-cursor pagination. | UI wiring is source-tested, not browser-qualified or deployed. |
| MCP | Advisory tool helper is implemented and tested for explicit account allowlists, metadata-only output and bounded composite pagination. | Not registered in main HTTP or stdio MCP because there is no authenticated caller-to-account entitlement binding. Do not expose until that authorization model exists. |
| Retention | Explicit preview/apply is wired to authenticated operator routes and generated admin UI; it is gated by explicit configuration, account allowlist and durable PostgreSQL. | Tokens are per-process, audit actor is generic `admin`, there is no scheduler, and cleanup does not remove parent messages/backups. Not browser/deployment qualified. |

## Acceptance gates

- **Helper-only:** a module or function exists and may have focused tests, but runtime ownership/configuration does not reach it.
- **Wired:** the supported runtime configuration reaches the component and the expected behavior is observable through its real application surface.
- **Accepted:** wired and all applicable gates below have reproducible evidence for a specific source commit, built image, and effective configuration. Unit/fixture tests alone never establish acceptance.

## Detailed source evidence and remaining boundaries

| Component | Checked-out source boundary | Not established |
|---|---|---|
| Classification and persistence | Conditional path in `startServer`: enabled account allowlist + newly inserted message invokes classification/persistence on HTTP and reverse WebSocket ingress; store accepts metadata only. `src/main.ts` now opts into this path only when `AI_ADVISORIES_ENABLED=true` and required classifier/database settings are present. | Default configuration remains disabled; startup wiring is source-tested, not proven against a real provider or database. Operator configuration is not user-level consent. |
| Schema/store | Migration `0014_ai_advisories.sql` defines metadata fields, account/message constraints, index and app-role grants. Migration 0003 converts runtime account/message IDs to `text`, matching these FKs. Store uses account-scoped composite keyset cursor (max 100). | Not run against real PostgreSQL; lock/scan impact for the `(account_id,id)` unique constraint and production role grants/ownership remain unqualified. |
| HTTP route | Node server exposes authenticated `GET /api/ai-advisories?account_id=...`, checks enabled store and account allowlist, and returns composite pagination cursor. `src/main.ts` supplies API config only when `AI_ADVISORIES_ENABLED=true`. | Separate Fastify helper has a distinct route and is not registered in the Node server; its cursor now matches the store's `(created_at,message_id)` ordering. No deployed DB/auth configuration qualified. |
| Admin UI | Panel is embedded in the admin template and generated page; it calls `/api/ai-advisories?account_id=…` using the token-bearing API helper, populates the account selector, renders safe metadata as text, and supports composite-cursor pagination. | UI wiring is source-tested, not browser-qualified or deployed. |
| MCP | Advisory tool helper is implemented and tested for explicit account allowlists, metadata-only output and bounded composite pagination. | Not registered in main HTTP or stdio MCP because there is no authenticated caller-to-account entitlement binding. Do not expose until that authorization model exists. |
| Retention | Explicit preview/apply is wired to authenticated operator routes and generated admin UI; it is gated by explicit configuration, account allowlist and durable PostgreSQL. | Tokens are per-process, audit actor is generic `admin`, there is no scheduler, and cleanup does not remove parent messages/backups. Not browser/deployment qualified. |

- **Consent schema:** migration `0015_ai_advisory_consent.sql` requires `aoi_app` to exist and fails closed if absent. Runtime requires SELECT/INSERT/UPDATE; revocation is an UPDATE (`enabled=false`), not DELETE. The ACL does not restrict an object owner, superuser, or inherited role privileges. Production migration role/ownership remains unqualified.

## Rollout gates (all required)
   - Define the authorized actor and account-level consent lifecycle: enable, inspect, revoke, and deletion request.
   - Document what content is sent to the classifier and provider data-handling responsibility.

2. **Validated, metadata-only persistence**
   - Wire persistence only after classification validation against configured labels and confidence bounds; prove malformed output, abstention, classifier exceptions, and disabled consent yield no row.
   - Ensure no message text, prompt, raw provider response, reason/explanation, summary, secrets, or arbitrary model fields enter SQL, logs, API, MCP, or UI.
   - Confirm duplicate-ingress safety, account/message ownership and versioning.

3. **Migration and durable database qualification**
   - Apply migration 0014 on clean and supported upgrade databases; inspect constraints and grants. `messages.id` is already the primary key, so the added `(account_id,id)` uniqueness is implied; this redundant constraint still incurs a table scan/lock and its production impact must be assessed against PostgreSQL version and table size.
   - Exercise real PostgreSQL insert/upsert, scoped pagination, errors, restart durability, cascades, backup/restore, and least-privilege role.

4. **Authenticated account-scoped surfaces**
   - Keep HTTP auth and account allowlist before reads; verify admin route wiring and ensure pagination works without gaps/duplicates. The standalone Fastify helper has a different route/cursor contract and must not be substituted for the active Node route without reconciling it.
   - For MCP, ensure the authenticated caller identity is authorized for the requested account; an operator allowlist/account parameter alone does not establish caller authorization. Stdio and standalone HTTP MCP remain unwired.
   - Wire UI to the safe route and qualify loading/empty/error states and accessible controls.

5. **Retention, deletion, consent withdrawal**
   - Choose a real retention period and schedule; wire explicit authorized deletion/retention workflow. Test isolation, boundaries and partial failures.
   - Define withdrawal behavior and verify cascades and backup implications; never delete parent messages during advisory cleanup.

6. **Failure safety**
   - Verify classifier/store outage, malformed results, unauthorized reads and migration failures do not corrupt ingress or trigger message actions.
   - Ensure errors/logs/metrics do not expose SQL, secrets, message or model payloads.

7. **Release evidence**
   - Run tests/build/security checks on final source and real PostgreSQL integration on the built image.
   - Record commit, image digest, configuration, DB version/migration, reproduction steps and rollback/disable procedure.

Until gates pass, keep persisted advisories disabled and label classification as experimental/transient. Worktree tests are not deployment evidence.
