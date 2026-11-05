# AI advisory MCP authorization contract

**Status: contract and required gates only; caller-to-account authorization is not implemented.** This document specifies the minimum authorization boundary required before any AI advisory MCP tool may be exposed. It does not assert that the requirements below are currently met.

## Protected operation

The protected operation is reading persisted AI advisory metadata for a single explicitly selected account. Authorization must be enforced for every tool invocation, before the store is queried. A tool argument such as `account_id`, a configured account list, or an operator-maintained account allowlist is not by itself proof that the invoking principal may access that account.

Advisory results are metadata only. An authorized response may include the account and message identifiers, label, confidence, model/policy version, and creation time. It must not expose message bodies, prompts, classifier raw output, explanations/reasoning, secrets, or arbitrary provider fields. Pagination must be bounded and deterministic. This read operation must not alter inbox state or trigger actions.

## Principal and identity source

1. The MCP transport/authentication boundary must authenticate the caller and establish a stable principal identifier (`sub` or an equivalent immutable subject). Do not derive identity from tool arguments, client-supplied headers that are not verified by the auth layer, account aliases, or the process/operator identity.
2. The identity source and its trust boundary must be explicit for each transport. For authenticated HTTP, validate credentials at the HTTP boundary and pass verified claims to the tool invocation through trusted server-side context. Never treat an unverified JWT payload or caller-supplied identity field as authenticated claims.
3. For each invocation, resolve the principal's current account entitlements from a trusted authorization source (for example, an authoritative principal-to-account grant store or verified identity-provider claims with defined freshness and revocation semantics). Bind the authenticated principal to the specific account ID, not merely to an operator's global account allowlist.
4. Require the requested account to be both enabled/eligible for this operation and explicitly authorized for this principal. The requested account must be one of the principal's effective authorized account IDs. Do not infer access from possession of a message ID, knowledge of an account ID, or access to another MCP tool.

## Fail-closed enforcement

- Missing, malformed, expired, unverifiable, or ambiguous identity/entitlement data denies access.
- Unknown principal, missing entitlement source, source timeout/error, stale data beyond the defined policy, disabled account, or absent account grant denies access. No fallback to a broader allowlist, default account, all accounts, or operator permissions is permitted.
- Perform authorization on every request, immediately before data access, using the exact requested account. Do not rely only on registration-time snapshots if grants can be revoked or changed; if caching is used, define and enforce a bounded freshness/revocation policy.
- Denial must happen before querying advisory rows and must not reveal whether an unauthorized account or advisory record exists. Return a generic authorization error. Do not leak claims, tokens, database details, or provider data in errors or logs.
- Scope the storage query itself to the authorized account ID. Never fetch broadly and filter results after retrieval.

## Registration and transport gates

A tool may be registered on a transport only when that transport supplies authenticated principal context and the tool's invocation path enforces the principal-to-account check above. Registration must not silently substitute a static `allowedAccountIds` list for principal authorization. Keep the tool absent when the transport cannot provide trustworthy identity and account entitlements.

### HTTP / Streamable HTTP

Before registering or exposing an advisory tool over HTTP, authenticate each MCP request/session, map verified caller identity to current account entitlements, and make that principal context available to every tool call. Verify authorization and denial with integration tests through the actual HTTP MCP entry point, including revoked grants and entitlement-source failure. A bearer token that only authenticates an operator or service is not automatically an end-user/account entitlement.

### Stdio

Stdio does not inherently establish a distinct authenticated end-user principal. Do not expose advisory reads on stdio merely because the process has database access or the operator configured an account allowlist. Stdio exposure requires a documented, trustworthy per-caller identity and principal-to-account authorization mechanism for the actual deployment model. If the process cannot distinguish/verify the caller and enforce that binding, the advisory tool must remain unregistered on stdio. A single-user deployment may define an explicit principal model, but it must be authenticated, narrow, revocable, and tested; process ownership alone is insufficient.

## Operator allowlist is an additional gate, not authorization

A configured operator account allowlist may constrain which accounts the service is permitted to serve. It is a service-side ceiling, not evidence that a particular MCP caller is entitled to any account in it. Effective access must be the intersection of:

- accounts enabled and eligible in the service configuration;
- accounts permitted by any operator/service allowlist; and
- accounts currently granted to the authenticated principal by the trusted entitlement source.

If any component is absent or cannot be established, deny. Never treat an explicit `account_id` supplied by the caller as consent or authorization.

## Current implementation boundary (checked-out source)

The advisory tool helper exists in `src/mcp-ai-advisories.ts`. It accepts a static `allowedAccountIds` list, checks that the requested account is in that list, then calls the account-scoped store and emits bounded metadata. The helper has no principal parameter and does not establish caller identity or a principal-to-account entitlement binding. `src/mcp-account-authorization.ts` contains a principal/account helper, but that helper is not wired into the advisory tool's invocation authorization path.

The MCP factory in `src/mcp.ts` can conditionally register the advisory helper when an `aiAdvisories` argument is supplied. However, the checked-in standard runtime wiring does not supply that argument: the advisory tool is **absent from both the standard Streamable HTTP MCP surface and the standard stdio MCP surface**. This is intentional fail-closed behavior in the current integration, not evidence that an authenticated account-level MCP authorization model is complete. Do not enable or wire the helper to either transport until the contract above is implemented and verified end-to-end.

This status describes the checked-out source, not a claim about any deployed image or runtime. The helper's existence or unit tests do not establish transport registration, authenticated caller identity, account entitlement, or production qualification.

## Minimum acceptance evidence before exposure

- Document the authenticated principal source and the account-entitlement source, including revocation/freshness behavior, separately for HTTP and stdio.
- Prove unauthenticated, invalid, expired, unknown, and ambiguous principals are denied before storage access.
- Prove a principal can read only explicitly granted, enabled accounts, including when the caller changes `account_id` or supplies another account's message identifiers.
- Prove operator allowlist membership alone does not grant a principal access; effective access is the intersection defined above.
- Prove revoked grants and entitlement-source failures fail closed on every invocation.
- Exercise the real HTTP and/or stdio MCP registration and tool invocation path, not only the helper in isolation. Keep any transport without a trustworthy identity binding unregistered.
- Verify account-scoped database queries, bounded pagination, metadata-only output, generic denials, and absence of sensitive values in logs/errors.
- Record source revision, effective configuration, transport, and reproducible test evidence. Unit tests alone do not qualify a deployed artifact.
