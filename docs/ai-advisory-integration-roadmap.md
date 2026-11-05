# AI advisory integration sequence and acceptance roadmap

**Status: planning document only. The sequence below is not evidence that these capabilities are implemented, deployed, or accepted.** The checked-out source contains an explicitly opt-in classification/persistence path, account-fenced Node read API and admin UI, plus isolated retention and MCP authorization/tool helpers. These do not yet provide the end-to-end consent, retention, MCP, or browser-qualified integrations described here. Default product use and deployment remain unaccepted; keep persisted advisories disabled until applicable gates pass for the exact release.

This roadmap covers four related workstreams: **(3) consent**, **(4) retention/deletion**, **(5) MCP authorization**, and **(6) browser verification**. Treat “helper exists” and fixture tests as source evidence only—not as a supported operator workflow, real database qualification, deployed feature, or user-facing acceptance.

## Dependency order

```text
Consent and account entitlement model (3)
        ├──> Retention / withdrawal / deletion workflow (4)
        ├──> MCP caller-to-account authorization (5)
        └──> Browser consent and advisory UX verification (6)
Database and privacy qualification ──> (4), (5), (6)
Authenticated account-scoped read API ──> (5), (6)
```

Consent is the product-level authority for whether classification and persistence may occur. The existing operator-controlled `AI_ADVISORIES_ENABLED` and account allowlist are not user consent. Retention and withdrawal need a defined consent/ownership model. MCP must bind the authenticated caller to the requested account; a tool argument or operator allowlist alone is insufficient. Browser verification depends on the actual consent controls and read API being registered and enabled. Database/schema qualification is a shared prerequisite for relying on stored records or deletion behavior.

## Ordered integration sequence

### 0. Establish release and data boundaries

Before wiring surfaces, identify the source commit, target image, supported configuration, database role/version, and classifier provider. Keep classification opt-in. Confirm the data sent to an external classifier, the metadata-only persistence contract, and the rule that advisories are informational: they cannot trigger inbox state changes, sends, notifications, or other automation.

**Acceptance evidence:** documented data flow and disable/rollback path; no claim of live provider/database qualification without reproducible evidence on the target image.

### 1. (3) Define and wire consent first

Specify the authorized actor and account-level lifecycle: grant/enable, inspect current state, revoke, and request deletion. Define whether consent is per account, who can grant it, how changes are audited, and what happens to in-flight classification when consent is withdrawn. Make the runtime consult this authoritative state before sending message content to the classifier and again before persisting a result, so a revocation race cannot create a new record. Keep operator feature flags as an additional deployment gate, not a substitute for consent. Default must remain off; unavailable or ambiguous consent must fail closed.

**Acceptance checks:** unauthorized/no-consent accounts cause no classifier request and no row; revocation blocks new work including in-flight persistence; consent changes are authorized, scoped, auditable, and survive restart; error paths do not reveal message content or credentials. Verify classifier provider/data-handling documentation and consent text against actual payload behavior.

**Current status:** no user-consent lifecycle is wired. Configuration is operator-controlled. Do not describe the present opt-in flag as user consent.

### 2. Qualify persistence before exposing additional readers or deletion

Apply migration `0014_ai_advisories.sql` on clean and supported upgrade PostgreSQL databases; inspect constraints, grants, lock/scan implications, and least-privilege behavior. Exercise real inserts/upserts, account ownership checks, pagination, cascades, restart durability, backup/restore, and failures. Reconcile the redundant `(account_id,id)` uniqueness constraint and production impact before large-table rollout. Verify malformed, abstaining, disabled-consent, and classifier-failure cases produce no persisted record and no ingress breakage.

**Acceptance evidence:** reproducible PostgreSQL integration results against the supported version and exact migration/image, with rollback and backup implications recorded. Unit tests or migration-file presence alone do not pass this gate.

### 3. (4) Integrate retention, withdrawal, and deletion

Choose and document a real retention period, policy versioning, and treatment of backups. Wire an authorized, account-scoped operator workflow and/or scheduler around the existing preview/apply helper; do not treat its helper defaults as an active policy. Require a dry-run/preview with bounded counts, explicit apply, and auditable outcomes. Consent withdrawal must have a defined effect on existing advisory metadata (retain until expiry or delete promptly); deletion requests must remove advisory rows without deleting parent messages. Handle partial failure, retries, and concurrent classification safely; verify cascades and ensure the system does not recreate records after withdrawal.

**Acceptance checks:** boundary timestamps, account isolation, batch limits, repeated/idempotent apply, partial failures, concurrent writes, restart/recovery, audit trail, and backup expiry/deletion semantics. Confirm preview does not mutate and cleanup never deletes messages. The scheduled/operated path must be visible in the production runtime, not merely callable as a helper.

**Current status:** a bounded account-scoped preview/apply helper exists, but there is no wired retention route, scheduler, operator workflow, configured retention period, or consent-withdrawal/deletion lifecycle. Automatic expiry must not be claimed.

### 4. (5) Integrate MCP authorization only after consent and read-surface policy

Define how each MCP transport authenticates callers and maps identity to authorized accounts. Enforce authorization server-side on every request, before data access, independent of supplied `account_id`; do not infer caller entitlement from an operator allowlist. Expose only allowlisted advisory metadata with bounded deterministic pagination and no message bodies, prompts, raw classifier output, or cross-account reads. Keep the helper tool unregistered on main HTTP/stdio MCP until the identity binding and authorization adapter are active. Cover HTTP and stdio separately; one transport's authentication does not establish the other's.

**Acceptance checks:** authenticated allowed caller, denied caller, missing identity, forged/other account ID, revoked account consent, disabled feature, store failure, and pagination boundary/continuation. Verify protocol registration and round-trip on the intended running transport and target image. Confirm audit/error output excludes sensitive payloads.

**Current status:** MCP helper/authorization components exist in the worktree, but advisory reads are deliberately not registered on main HTTP or stdio MCP because caller-to-account entitlement is not established. Do not claim MCP availability based on helper tests.

### 5. (6) Verify the browser experience against the integrated behavior

After consent and API contracts stabilize, wire the actual browser UI for consent state and account-scoped advisory reads. Ensure the UI reflects disabled, granted, revoked, empty/not-classified, loading, expired/deleted, and error states distinctly; do not present a missing advisory as a negative classification. Render only safe metadata as text, expose no model-generated explanation, and provide no action controls that imply advisory-driven automation. Ensure accessible labels, keyboard operation, focus/error announcements, and clear disclosure of external classifier processing. Verify revoked consent immediately prevents new classification and that any existing-data deletion status is accurately represented.

**Acceptance checks:** browser-driven tests against a running application and representative persisted data; authenticated account switching/isolation; consent grant/revoke flows; pagination; failure and empty states; accessibility checks; no XSS from labels/model identifiers; no sensitive content in DOM, network responses, logs, or screenshots. Include deployed-artifact inclusion and browser smoke on the exact built image. Source/UI unit tests alone do not establish browser qualification.

**Current status:** an admin advisory panel is wired in checked-out source and has source tests, but browser behavior/accessibility and deployed artifact inclusion are not qualified. No browser verification acceptance is established.

## Final release gate

Do not mark any of these four workstreams accepted until all dependencies above that apply are complete, evidence is reproducible on an identified commit/image/configuration, and failures are covered. Record PostgreSQL and classifier versions, consent configuration, MCP transport/auth mode, browser/runtime versions, test commands/results, operator/date, and known limitations. Keep worktree source state, fixture/CI results, live integration, and deployed qualification as separate evidence categories. Until then, describe each capability as unimplemented or partially present as specified above, and keep persistent AI advisories disabled for product use.
