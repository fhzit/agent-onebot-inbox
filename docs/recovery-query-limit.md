# Recovery query window limitation

## Finding

History reconciliation currently obtains its local comparison set with `store.list(accountId, maxMessages)` in `src/history-reconciliation-service.ts`. The runtime `PostgresMessageStore.list()` clamps its limit to 200 and orders newest-first (`src/postgres-store.ts`). Consequently, an older provider message is treated as missing whenever it falls outside the latest 200 local messages for that account. Raising `maxMessages` in the service cannot fix this: the runtime store silently clamps it. The store's `query()` does support offset/limit pagination, but its public `InboxQuery` interface is not a safe drop-in without adapting callers and pagination consistency concerns.

## Safe migration plan

1. Add a purpose-specific bounded store operation, e.g. `listConversationWindow(accountId, conversationId, before, after)`, to the runtime store contract and implement it in both `PostgresMessageStore` and the in-memory store. Query by exact account and conversation/target, order deterministically by `(sent_at, id)`, and use keyset pagination or a carefully bounded offset window. Do not use the account-wide newest-first `list()` for reconciliation.
2. In the history reconciliation service, compare provider history only against local messages from the requested conversation, loading enough rows to cover the explicitly requested bounded reconciliation window. Keep a hard cap and report truncation rather than implying a complete comparison when the cap is hit.
3. Ensure the route passes the same validated conversation identity (kind and target) used for provider history, and preserve dry-run behavior and audit metadata. Review existing `MAX_RECONCILIATION_MESSAGES` semantics before changing it.
4. Add regression coverage with more than 200 local messages where an older matching provider message is outside the newest 200, plus conversation isolation, deterministic ordering, cap/truncation, and in-memory/PostgreSQL adapter tests.
5. Run focused reconciliation/store tests and then the full suite. Wire the new query through `src/server.ts` only after coordination with its current owner; this task intentionally did not modify that shared file.

## Status

No code was changed because wiring the query safely requires coordinating the runtime route and its store contract, while `src/server.ts` is concurrently owned. The concrete implementation boundary and regression criteria are documented above.