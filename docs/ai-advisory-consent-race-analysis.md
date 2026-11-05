# AI advisory consent and classification race threat model

**Purpose:** identify the concurrency and failure boundaries that must be satisfied before consent-gated classification or persistence is considered safe. This is an analysis and acceptance specification, not a claim that the runtime currently meets it.

## Current implementation boundary

The consent service reads then writes state with a per-account revision, but its repository contract exposes no atomic compare-and-set/transaction. The supplied in-memory repository is process-local and not multi-worker safe. The consent gate queries before classification and again before persistence, and returns false when either query/classifier/persist throws. That second query narrows the race window but does not make the check and write atomic.

Critically, `persistIncomingAiAdvisory` currently performs classification and calls the store directly; it does not invoke `withAiAdvisoryConsent` or read the consent table. The configured runtime path is operator-enabled/account-allowlisted. The SQL consent table is separate from the advisory insert, and the advisory insert checks message/account association, not consent. Thus the existing helper tests do not establish end-to-end consent enforcement. The acceptance criteria below describe the necessary security behavior, not present behavior.

## Assets, actors, and security objective

- **Assets:** account-scoped consent state and its ordering/revision; message text sent to a provider; advisory metadata written to the database; privacy-safe audit evidence.
- **Actors/failures:** authorized consent manager, concurrent ingestion workers, operators changing deployment gates, database/network failures, slow or non-cancellable providers, retries/duplicate deliveries, and stale replicas/caches.
- **Objective:** a classification request may begin only under current, authoritative consent for that exact account and policy/disclosure version. A result may commit only if that consent is still current at the persistence serialization point. Uncertainty means no provider request and no advisory write. Ordinary message ingestion must continue if optional advisory work fails.

## Threat scenarios and required controls

### 1. Check/use race: revocation between initial check and provider dispatch

A worker reads active consent, then revocation commits before the worker sends message text to the provider. A later pre-write check cannot undo that disclosure. Checking only at persistence is therefore insufficient.

**Required:** bind the authoritative consent revision and policy/disclosure version to a processing authorization; revalidate at the last possible point before provider dispatch. Define that point as the authorization linearization point: if revocation commits before it, no provider request may be issued. If revocation commits after dispatch has begun, the request may already disclose content; attempt cancellation, but treat cancellation as best-effort and never claim the provider did not receive it. Record this residual boundary in operator/user disclosure.

### 2. Check/use race: revocation after second check but before/during database write

The helper's second query and `persist(result)` are separate operations. Revocation can commit in that gap, or while an insert is in flight, allowing a post-revocation write. A transaction-independent “check immediately before” remains vulnerable.

**Required:** enforce consent state and advisory write atomically in the same database serialization boundary (e.g. transaction with a row lock/serializable protocol, or conditional write whose predicate checks the current enabled state and captured revision). Revocation must use the same ordering mechanism. Specify commit ordering: a write that linearizes before revocation may remain; a write that linearizes after revocation must fail. If policy requires no advisory visible after revocation returns, revocation must additionally wait for/drain earlier authorized writes or synchronously remove them. State which policy applies; do not imply that blocking late writes retroactively deletes existing records.

### 3. Consent repository unavailable, stale, or ambiguous

Initial read failure, timeout, missing row, malformed state, stale cache/replica, or inconsistent account scope can otherwise be interpreted as active. A successful old read followed by an unavailable recheck is also unsafe.

**Required:** all unknown/error/timeout states deny dispatch and persistence; never fall back to cache, environment allowlist, prior in-memory state, or permissive defaults. Read from the authoritative consistency domain used by revoke/write. Failures must not expose content or secrets and must not prevent ordinary message handling. Recovery must require a fresh authoritative check, not reuse an authorization token past its defined lifetime.

### 4. In-flight provider work and timeout/cancellation ambiguity

A provider may ignore abort, return after timeout/revocation, or complete while the worker is shutting down. Aborting a client request does not prove the remote provider did not receive/process the payload. A late result must not bypass consent checks through a callback, retry queue, or alternate persistence path.

**Required:** associate every work item with account, consent revision, message identity, and policy/disclosure version; cancel best-effort on revoke; discard all late results unless the atomic write predicate still matches current active consent and revision. Provider timeout/error/abort is an abstention. No retry may dispatch without a new authoritative pre-dispatch check. Do not persist raw result, reason, prompt, or text. Document that remote processing already started cannot necessarily be recalled.

### 5. Concurrent enable/revoke and revision races

Two simultaneous service operations can both read revision N and both write N+1; last-writer-wins can reorder user intent, lose audit history, or allow a stale enable to overwrite a newer revoke. Equal timestamps do not define order. Repeated revoke/enable operations also need explicit semantics.

**Required:** serialize lifecycle transitions per account in durable storage, with monotonic revision allocated atomically and stale writes rejected. The operation order must be the database commit order or an explicit compare-and-set version. Audit each accepted transition with actor, scope, disclosure/policy version and revision. An enable concurrent with revoke must have deterministic ordering; only a subsequent explicit affirmative enable may restore active status. Retried requests must be idempotent or safely produce a new, auditable revision without resurrecting stale consent.

### 6. Duplicate delivery, retry, and competing classification

The runtime only classifies newly inserted messages, but redelivery, worker retries, parallel handlers, or policy-version changes can still create duplicate provider calls or conflicting writes. Current advisory upsert can overwrite label/confidence for the same `(account, message, policy_version)` and update its timestamp. A duplicate may also race with revocation.

**Required:** define idempotency key and uniqueness scope for classification jobs and persisted advisories. For one key, concurrent workers must not create multiple committed outcomes or let an older result overwrite a newer policy/consent epoch. Every retry rechecks consent before dispatch and uses the atomic write gate. Duplicate persistence must be deterministic and auditable; do not silently replace an existing result unless the policy explicitly allows it. New policy/disclosure versions require an explicit rule for whether reclassification is allowed under current consent.

### 7. Database write failure or uncertain commit

A DB error can occur before commit, after commit with lost acknowledgement, or during failover. Blind retry may duplicate provider disclosure or overwrite a valid result. A separate consent DB and advisory DB can observe different state.

**Required:** provider dispatch and advisory persistence are optional; DB failure produces no success indication and does not interrupt message handling. Use transactional/idempotent writes to resolve uncertain commit safely. Consent read, revocation, and conditional advisory insert must share an authoritative database/consistency domain or another explicitly proven ordering protocol. Never treat unavailable consent storage as consent. Surface a privacy-safe operational metric/audit status, not message content.

### 8. Global gate, account scope, and configuration drift

An operator flag or account allowlist is not user consent. A mismatch between the message account, consent account, and policy account could classify or write across tenant boundaries; a global disable may race with in-flight work.

**Required:** require both independent gates (operator/global enabled AND exact-account active consent); compare the same canonical account identifier at dispatch and persistence. The global gate must be rechecked at both boundaries, and writes must be blocked after disable according to a documented linearization rule. Neither allowlisting nor cached configuration may grant consent. Cross-account/missing scope always denies.

## Concrete acceptance cases (must be automated)

Tests should use controllable barriers/deferred promises and a repository/store model that can interleave operations; happy-path unit tests alone are insufficient.

1. **No grant / revoked / malformed scope:** assert zero classifier calls and zero writes for absent consent, revoked consent, invalid account, account mismatch, and invalid consent state.
2. **Initial consent DB failure:** make the authoritative read reject/time out; assert no provider call, no write, and successful completion of the ordinary message path.
3. **Revocation wins before provider authorization:** pause after eligibility but before dispatch authorization, commit revoke, resume; assert provider call count remains zero.
4. **Revocation after provider dispatch begins:** pause provider, revoke, then return a valid result; assert the request is best-effort cancelled/discarded and cannot persist. Test provider ignoring abort as well as honoring it.
5. **Revocation during final write:** pause at the atomic persistence boundary, race revoke, and assert the specified serialization rule: if revoke commits first the advisory insert is rejected; if write commits first, it is treated as pre-revoke and any stronger deletion/drain promise is separately verified.
6. **No TOCTOU gap:** prove with concurrent integration test that the production DB transaction/conditional statement—not just a mock precheck—prevents a write whose authorization revision became stale before commit.
7. **Recheck unavailable:** make initial read active and final authoritative check fail; assert no persistence. Where atomic write is used, simulate DB unavailable/ambiguous transaction outcome and assert no false success.
8. **Concurrent enable/revoke:** run both operations from the same starting revision in both orders; assert unique monotonic revisions, deterministic final state, no lost transition, and stale enable cannot overwrite a later revoke.
9. **Duplicate/retry:** deliver the same message concurrently and retry after an uncertain commit; assert the documented provider-call/idempotency bound, one deterministic persisted outcome per key, and no stale result overwrite.
10. **Retry after revocation:** fail provider or DB, revoke, then execute queued retry; assert no second provider call and no write.
11. **Re-enable semantics:** after revoke, assert no processing until a new explicit grant with a later revision; stale jobs carrying the prior revision remain denied.
12. **Global disable race:** disable globally while classification is in flight; assert no write after the disable linearization point and no path treats the global flag as consent.
13. **Isolation:** exercise two accounts concurrently; revoke one and prove the other remains independently authorized, with no cross-account provider input or persistence.
14. **Failure containment and privacy:** classifier/consent/store failures do not break message ingestion; logs, errors, audit rows and metrics contain no message text, prompts, raw provider result, credential, or unbounded provider error.
15. **Read-after-revoke contract:** verify the chosen visibility/deletion policy against the primary store, including any requirement to drain in-flight writes; do not assert deletion if policy only promises to block future writes.

## Release gate / evidence

Do not describe consent revocation as race-safe until the actual runtime path is wired through authoritative consent checks, the provider-dispatch boundary and advisory commit share a demonstrated ordering protocol, and the concurrency cases above pass against the production database adapter (not only in-memory fakes). Include the migration/runtime wiring, exact transaction or conditional-write semantics, integration-test output, retry/idempotency behavior, and the documented in-flight provider disclosure in release evidence. Until then, treat the consent helper as a contract/prototype and keep consent-based persisted classification disabled or explicitly unapproved.