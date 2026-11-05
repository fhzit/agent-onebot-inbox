# AI advisories: user guide

AI advisory configuration is off by default and can be explicitly enabled in `src/main.ts` using the documented environment variables. Persistence requires a configured HTTPS classifier endpoint/model, explicit account allowlist and labels, and `DATABASE_URL`. The embedded admin panel calls the authenticated account-fenced Node API. Advisory reads are not exposed through main HTTP or stdio MCP because no caller-to-account entitlement binding is established. The helper tool remains a separate module. Migration 0014 and deployment have not been qualified against a real PostgreSQL environment.

## What an advisory is—and is not

An advisory is an optional label and confidence estimate associated with a message. It is informational only. It must not change inbox state, send or revoke messages, notify anyone, create tasks, or trigger other automation. A missing result means “not classified”; it does not mean low priority or a negative classification.

Classification helpers can process a bounded normalized message and validate the result against an allowed label set. The regular server entry point constructs and passes an AI classifier and `aiAdvisories` runtime config only when explicit opt-in is enabled.

## Opt-in and data sent

The persistence option currently uses operator-supplied runtime config (`enabled: true` plus an account ID allowlist); this is an operator-controlled feature gate, not a user-consent workflow. For `src/main.ts`, use `AI_ADVISORIES_ENABLED=true` with the required classifier, account, label, and durable database variables above. It does not expose a UI control to grant or revoke consent. Absence or disabled configuration does not enable storage.

Classification requires message content to be evaluated by the configured classifier. If that classifier is an external service, the message content sent to it leaves this application; confirm the provider, its data handling, and configuration before enabling it. This repository does not bundle a model or establish a particular provider's retention or training practices.

## What would be stored

The dedicated PostgreSQL schema and store are designed to keep metadata only:

- account ID and message ID (for scoped association);
- validated label and confidence (0–1);
- model identifier, policy version, and creation timestamp.

The stored metadata schema contains only account/message IDs, label, confidence, model, policy version, and timestamp. Malformed/abstaining classifier output is not persisted by the runtime helper. The store validates field bounds; the classification path validates labels and confidence against the supplied policy.

## Access and scope

The Node route is `GET /api/ai-advisories?account_id=…`; the management page calls this route and passes a composite timestamp/message-ID cursor. The route requires the bearer API token, an enabled advisory store, and a configured account allowlist. The isolated Fastify handler uses a different route (`/api/accounts/:accountId/ai-advisories`) and is not registered by the Node server; it now uses the same composite timestamp/message-ID cursor contract. Advisory MCP reads are not registered on main HTTP or stdio surfaces because no caller identity-to-account entitlement binding is available.

## Retention, deletion, and message deletion

The schema ties advisories to their account and message; deleting either parent cascades to associated advisory metadata. The retention helper supports an explicit preview followed by a separate apply call, scoped to one account and bounded to at most 500 records per batch. Its defaults (365 days and 100 records) are helper defaults, not an active deployment policy. There is no wired retention scheduler, operator route, consent-management/delete workflow, or documented configured retention period in the server. Do not claim automatic expiry or deletion controls are active.

## Failure and availability

The server catches classifier and persistence failures on ingress and continues message handling. The classification and persistence operation is best-effort. The active Node API maps store failures to a generic 503 response. Real PostgreSQL operation and deployment configuration have not been verified. The management page is wired to the active route in the current source; advisory reads are not exposed on main HTTP or stdio MCP because caller-to-account entitlement is not bound.

## Before enabling or relying on this feature

Operators should not enable the feature until the normal startup configuration and consent boundary are documented and all acceptance gates in [AI advisory acceptance and rollout gates](ai-advisory-acceptance.md) pass for the exact image and configuration. In particular, verify migration and PostgreSQL durability, account isolation, deletion/retention, privacy-safe failures, and actual API/MCP/UI registration. Fixture tests and helper modules alone are not deployment qualification.
