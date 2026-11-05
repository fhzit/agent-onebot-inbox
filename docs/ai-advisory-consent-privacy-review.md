# AI advisory consent: privacy review and implementation gates

**Scope:** review of the consent helper, proposed SQL persistence, HTTP wrapper, and helper gate against the current advisory runtime. This documents risks and release gates; it does not change source code or certify deployment behavior.

## Executive finding

The consent work is presently a helper/prototype, not an active user-consent enforcement boundary. The durable consent migration stores a current row, and the consent API/helper can grant, revoke, and query it. But `persistIncomingAiAdvisory` in `src/ai-advisory-runtime.ts` invokes classification and persistence directly; it does not query consent or call `withAiAdvisoryConsent`. The main configured processing path is controlled by operator configuration/account allowlisting, which is not user consent. Therefore a stored revocation does not currently stop that path. Do not describe consent-gated processing or race-safe revocation as implemented.

## Data actually retained

### Consent helper contract and HTTP response

`src/ai-advisory-consent.ts` defines grant/revoke state with exact fields:

- `accountId` — tenant/account identifier;
- `enabled` — boolean state;
- `grantedAt` or `revokedAt` — ISO timestamp;
- `grantedBy` or `revokedBy` — caller-provided `actor` string;
- `revision` — per-account integer intended for ordering.

The helper validates actor and account as trimmed non-empty strings up to 128 characters, but does not establish that actor is authenticated or canonical. The API responds with the full consent state, including actor, timestamps, and revision. The query endpoint is therefore a disclosure surface for audit/identity data and must remain account-authorized. Do not put names, emails, tokens, session identifiers, or free-form notes in actor; prefer a stable, opaque authenticated subject ID.

`migrations/0015_ai_advisory_consent.sql` defines a different/current-row shape: `account_id`, `enabled`, `actor`, `disclosure_version`, `created_at`, `updated_at`, `revision`. It has no append-only transition/history table. A revoked row records the latest actor/state, not the grant/revoke timeline. No message text or advisory payload is represented in these fields. Account deletion cascades consent deletion, which conflicts with any requirement to retain audit history after account deletion and needs an explicit policy decision.

There is a contract mismatch to resolve before wiring: helper/API state requires `grantedBy`/`revokedBy` plus event timestamps and does not include `disclosure_version`; the migration has a single `actor`, `created_at`/`updated_at`, and mandatory `disclosure_version`. The helper allows 128-character actor values, while SQL allows up to 200. Do not rely on either layer's validation as the final schema contract.

### Advisory processing data and exposure

The current advisory persistence schema/store is metadata-oriented (account ID, message ID, validated label/confidence, model, policy version, timestamp); the runtime passes normalized message content to the classifier. If configured to call an external classifier, message text leaves the application. Consent metadata does not itself prevent this transfer. Existing user guidance correctly distinguishes operator allowlisting from user consent and notes the provider data-handling uncertainty.

### Logs and operational trace

The consent API logs caught errors via `{ err: error }`. Provider/database errors can contain request or response details; establish redaction/allowlisting before treating this as privacy-safe. Avoid logging actor values, message text, prompts, raw classifier output, credentials, or unbounded upstream error text. Audit requirements should use bounded structured fields (account reference, opaque actor reference, action, revision, disclosure/policy version, outcome/time) with access control and retention—not general application logs.

## Privacy and security risks

1. **Consent is not enforced by active processing.** The runtime calls classifier/store without consent lookup or helper gate. The standalone gate tests do not prove end-to-end behavior. The current operator enable flag/allowlist is a separate deployment gate, not affirmative per-account consent.
2. **Revocation has a pre-dispatch disclosure race.** Gate checks active state, classifies (which may send text externally), then rechecks before persistence. Revocation after the first read but before provider dispatch cannot be undone by the second read. Provider abort is not proof the remote service did not receive content.
3. **Persistence has a TOCTOU race.** The second query and `persist` are separate operations. Revocation may commit between them or while an insert is in flight. Gate catches errors and returns false, but does not make the consent check and advisory write atomic.
4. **Transition revision is not concurrency-safe in the helper.** Enable/revoke both read then write `(previous.revision ?? 0) + 1`; simultaneous operations can assign duplicate revisions and last-writer-wins can lose intent. The in-memory repository is process-local and not multi-worker safe. The SQL table alone does not prove the service uses an atomic update/lock/CAS.
5. **Actor is caller-supplied in the API body.** The API checks authentication and account authorization through dependency callbacks, but accepts `body.actor` rather than deriving it from verified claims. A caller can misattribute a consent event unless wiring explicitly binds actor to authenticated identity. The separate authorization helper can resolve a principal subject, but the API code shown does not use it itself.
6. **Disclosure acceptance is underspecified.** Migration requires `disclosure_version`, yet helper/API do not collect or validate it. A grant must be tied to the exact disclosure and processing purpose shown to the user; a generic enabled flag is insufficient evidence of informed consent.
7. **Data minimization and retention are unresolved.** Account/actor IDs and timestamps are personal or linkable data. Current-row storage loses prior transitions; account cascade erases it. Decide whether an audit trail is required, how long retained, who can access it, and how deletion requests interact with legal/audit obligations. Avoid collecting more actor detail than necessary.
8. **Failure and consistency semantics need proof.** Gate fails closed on thrown query/classifier/persist errors, but a missing/stale row or stale cache can be misinterpreted unless authoritative state is guaranteed. Consent and advisory writes must use a proven shared consistency/ordering domain.

## Required implementation gates (before claiming consent support)

### Gate A — model and purpose contract

- Reconcile TypeScript and SQL fields, lengths, nullability, timestamps, and disclosure-version requirements.
- Define whether storage is current state only or an immutable transition audit. Specify actor identifier type, access, retention, and account-deletion behavior.
- Present clear purpose, data categories (message content may be sent to the configured provider), provider/transfer details, retention/deletion limits, and revocation consequences before affirmative grant; version that disclosure and persist its exact version.
- Keep optional advisory processing separate from required message handling; no consent must mean no advisory provider dispatch/write.

### Gate B — verified identity and tenant binding

- Derive actor from verified authentication claims, never request body. Bind requested account to verified entitlement and canonical account ID at every operation.
- Ensure query responses expose only the authorized account's consent data; avoid unnecessary actor details in user-facing responses.
- Test malformed, missing, cross-account, disabled-account, and forged-actor cases. Fail closed on authorization errors.

### Gate C — authoritative lifecycle and revocation ordering

- Implement durable per-account atomic revision allocation and transition ordering (row lock/CAS/transaction); stale writes must be rejected. Specify idempotency and concurrent grant/revoke semantics.
- Use authoritative primary-consistent consent state; no permissive fallback to cache, allowlist, old in-memory state, or missing-row interpretation.
- Define the in-flight provider boundary explicitly. Revalidate immediately before dispatch; if revoke wins first, dispatch zero requests. If dispatch already began, cancellation is best-effort and documentation must not promise recall.
- Make advisory persistence conditional on the exact active consent revision and policy/disclosure version within the same serialization boundary as the insert. Revocation must participate in that ordering. State whether revocation only blocks later commits or also drains/deletes already committed advisories.

### Gate D — runtime integration and containment

- Wire the actual `persistIncomingAiAdvisory` path through both the operator/global gate and exact-account active consent; do not treat one as a substitute for the other.
- Recheck the global gate at dispatch and persistence boundaries. Pass the exact same account identifier through consent, classifier job, and store.
- Bind asynchronous work/retries to account, consent revision, message identity, and policy/disclosure version. Recheck before every provider retry; discard late results if consent is revoked or revision changed.
- Make advisory failure best-effort without breaking message ingestion. Unknown consent, timeouts, repository errors, invalid state, or uncertain writes must produce no provider dispatch when not yet started and no advisory write/success claim.

### Gate E — privacy operations and evidence

- Redact or allowlist structured error fields; prohibit message text, prompt, raw output, secrets, and unbounded provider errors in logs, metrics, audit rows, and API errors.
- Document provider data handling and residual in-flight disclosure, access controls for consent/audit data, backup/deletion behavior, and retention policy.
- Demonstrate account-scoped migration/permissions and cascade behavior against the production database adapter; migration 0015 permissions and runtime role must be verified, not inferred from SQL text.

## Minimum release evidence

Do not claim the feature is consent-safe until all of the following are demonstrated in the actual server path and durable database adapter:

- absent/revoked/malformed consent: zero classifier calls and zero advisory writes;
- initial consent read failure: no provider request, no advisory write, ordinary message processing succeeds;
- revoke before provider authorization: zero dispatch; revoke after dispatch begins: late result cannot persist;
- concurrent revoke versus final persistence: transaction/conditional write proves the documented commit ordering (not a mocked precheck);
- concurrent grant/revoke: unique monotonic revisions, no lost transition, stale grant cannot resurrect revoked state;
- queued retry after revoke: no new provider dispatch;
- two-account isolation and global-disable race;
- safe actor derivation, disclosure-version capture, and API response authorization;
- privacy-safe logs/errors, and verified account deletion/retention/audit behavior;
- migration and integration-test output for the production database path, plus deployment smoke evidence for the exact image/config.

Until then, treat the consent helper and gate as an unintegrated contract/prototype. Keep persisted classification disabled or explicitly unapproved where affirmative consent is a prerequisite.