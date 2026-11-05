# AI advisory consent and operations requirements

**Status: REQUIREMENTS ONLY — NOT IMPLEMENTED.** This document describes the product and operator controls required before AI advisory persistence can be enabled as a consent-based feature. It is not evidence that consent management, deletion requests, audit records, or these workflows exist in the application. Current source configuration is operator-controlled and is not a user-consent workflow; see [AI advisory user guide](ai-advisory-user-guide.md) and [acceptance and rollout gates](ai-advisory-acceptance.md).

## 1. Scope and purpose

An AI advisory is optional metadata derived from message content. It is informational only and must not send, modify, or revoke messages, change inbox state, notify people, or trigger other automation.

Before enabling this feature, product owners must define and publish its purpose, eligible accounts, authorized consent actor, intended users, retention period, and support/contact path. Consent must be explicit, affirmative, account-scoped, and recorded before any content for that account is submitted to a classifier or any advisory is persisted. Silence, account allowlisting, API authentication, and a global operator feature flag are not consent.

## 2. Data scope and minimization

The product and operator disclosure must distinguish data processed transiently from data persisted:

- **Input:** the exact message fields and any context included in the classifier request. Specify whether attachments, quoted text, sender identity, or conversation history are excluded; exclude them unless separately justified and disclosed.
- **Provider request:** identify the configured classifier/provider, endpoint region where known, and the fields sent. Send only the minimum bounded content needed for classification. Do not send credentials, unrelated account data, or hidden conversation history.
- **Persisted advisory:** limit storage to account/message association, validated label and confidence, model identifier, policy version, and timestamp, consistent with the existing metadata-only schema. Never persist message text, prompts, raw provider responses, explanations, summaries, secrets, or arbitrary model fields.
- **Operations:** logs, metrics, audit entries, backups, and support exports must not contain message content, prompts, raw results, or secrets. Document the metadata retained in each operational system and its expiry.

This is a requirements boundary, not a claim that every runtime path has been assessed or meets it.

## 3. Enablement and consent record

An authorized account owner or explicitly delegated administrator must be able to review the disclosure and enable AI advisories for a clearly identified account. The enable action must capture a durable, auditable record containing at least account scope, actor identity, decision, disclosure/consent text version, timestamp, and effective status. The interface must show whether consent is active and how to revoke it.

Consent must be checked at the point of processing, not only at setup. No consent record, invalid/ambiguous scope, unavailable consent state, or a disabled global operator gate must result in no provider request and no persisted advisory. Enabling one account must not enable any other account. Changes to purpose, provider, data scope, or material disclosure require renewed consent before processing under the changed terms.

The operator's global feature gate is a separate emergency/deployment control. It can disable processing globally but cannot grant account consent.

## 4. Revocation and fail-closed behavior

An authorized actor must be able to revoke consent for an account. Revocation must be effective before subsequent classification requests or writes: cancel or disregard in-flight work where possible, and prevent late results from being persisted after revocation. Reads should reflect the revoked state according to the documented product policy; revocation must never cause message actions.

If consent status cannot be read or verified, the system must fail closed: do not call the provider, do not persist, and do not infer consent from cached stale state. Report a safe, actionable status to the authorized operator without exposing message content. Re-enabling requires a new affirmative consent action and record; it must not silently undo revocation.

## 5. Access authorization

Advisory access must require authenticated identity and authorization for the specific account on every read, export, consent change, and deletion action. An operator-configured account allowlist is a deployment boundary, not proof that a particular caller is entitled to that account. Deny by default, including for MCP or other tool interfaces until caller identity is bound to account entitlements.

Use least privilege and separate permissions for viewing advisories, managing consent, and executing deletion where practical. Responses and UI must expose only the authorized account's bounded metadata. Unauthorized, cross-account, or ambiguous requests must fail without revealing whether another account has advisories.

## 6. Deletion requests and retention

Provide a documented route for an authorized person to request deletion of advisory data for an account or specified message(s), with identity/scope verification, request status, and completion confirmation. Define the requester's authority, permitted scope, applicable exceptions, service target, and escalation path before launch.

Deletion must remove only advisory records in scope; it must never delete parent messages. Verify deletion against the primary store and document behavior for replicas, caches, exports, backups, and provider-side data. If backups cannot be selectively edited, disclose the expiry period and ensure restored data cannot silently reintroduce deleted advisories. Deletion failures or partial completion must remain visible to operators and must not be reported as complete.

Define and implement a bounded retention period and scheduled or otherwise reliable expiry before launch. Consent withdrawal and deletion request are distinct: specify whether withdrawal also deletes existing advisory records, and make any such cleanup explicit and auditable. The current helper-only retention behavior is not an active schedule or deletion workflow.

## 7. Provider disclosure and operation

Before consent, disclose that message content is sent to the named/configured classifier provider, which fields are sent, the purpose, and any known provider retention, training, subprocessors, and processing-region terms. If these provider practices are unknown or change, do not imply a guarantee; block enablement or require review and updated disclosure/consent as appropriate. Operators must verify endpoint security and credential handling and must not treat HTTPS alone as a privacy or data-retention guarantee.

Provider failures, timeouts, malformed output, abstentions, or policy validation failures must produce no advisory and must not interrupt ordinary message handling. Do not retry in a way that bypasses consent checks. Provider response content must not appear in logs or user-visible errors.

## 8. Operational audit and accountability

Maintain a tamper-resistant, access-controlled audit trail for consent enable/revoke, disclosure-version changes, authorized reads/exports where required by policy, deletion requests and outcomes, and operator global disable/enable actions. Record actor, account scope, action, timestamp, outcome, and relevant policy/disclosure version. Do not place message content, prompts, raw classifier responses, credentials, or unnecessary personal data in audit events.

Define audit access, retention, monitoring, incident escalation, and review ownership. Alert on unexpected processing without active consent, repeated authorization failures, deletion failures, and configuration drift. Ensure audit/logging failure cannot default consent to active or permit otherwise-denied processing.

## 9. Launch gate

These requirements are not satisfied merely because configuration, a metadata schema, helper functions, or tests exist. Before product launch or production enablement, obtain evidence that the consent and authorization controls are wired into every processing and access path, revocation blocks late writes, deletion/retention works including backup implications, provider disclosure matches actual requests, and operational audit is privacy-safe. Until then, do not describe AI advisory as consent-managed or claim these controls are implemented; keep persisted advisory processing disabled unless separately approved under the applicable acceptance gates.
