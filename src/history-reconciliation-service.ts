import type { AccountConfig } from './config.js';
import type { NormalizedMessage } from './normalize.js';
import { fetchProviderHistoryPage, type HistoryApi, type HistoryKind } from './provider-history.js';
import { planHistoryReconciliation, MAX_RECONCILIATION_MESSAGES, type HistoryReconciliationPlan } from './history-reconciliation-planner.js';
import type { AuditEntry, AuditStore } from './audit-store.js';

export type HistoryReconciliationRequest = {
  account: AccountConfig;
  accountId: string;
  kind: HistoryKind;
  targetId: string | number;
  count: number;
  signal?: AbortSignal;
};
export type HistoryReconciliationDependencies = {
  fetchHistory?: (request: HistoryReconciliationRequest, count: number) => Promise<readonly NormalizedMessage[]>;
  historyApi?: HistoryApi;
  store: { list(accountId?: string, limit?: number): Promise<NormalizedMessage[]> | NormalizedMessage[] };
  plan?: typeof planHistoryReconciliation;
  audit: Pick<AuditStore, 'record'>;
  maxMessages?: number;
};

/** Compose bounded provider fetch, local comparison, and audit only; never imports or persists messages. */
export function createHistoryReconciliationService(deps: HistoryReconciliationDependencies) {
  const maxMessages = deps.maxMessages ?? MAX_RECONCILIATION_MESSAGES;
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1) throw new Error('maxMessages must be a positive safe integer');
  if (!deps.fetchHistory && !deps.historyApi) throw new Error('A history fetch dependency is required');
  return async (request: HistoryReconciliationRequest): Promise<{ plan: HistoryReconciliationPlan }> => {
    if (!Number.isSafeInteger(request.count) || request.count < 1) throw new Error('History count must be a positive safe integer');
    if (!request.accountId.trim()) throw new Error('accountId is required');
    const count = Math.min(request.count, maxMessages);
    const auditBase: Omit<AuditEntry, 'result'> = {
      actor: 'admin', action: 'history.reconcile.dry_run', account_id: request.accountId,
      target_type: 'conversation', target_id: String(request.targetId),
      metadata: { kind: request.kind, requestedCount: request.count, boundedCount: count, dryRun: true },
    };
    try {
      const provider = deps.fetchHistory
        ? await deps.fetchHistory(request, count)
        : (await fetchProviderHistoryPage(deps.historyApi!, request.account, request.kind, request.targetId, count, request.signal ? { signal: request.signal } : {})).messages as NormalizedMessage[];
      const boundedProvider = provider.slice(0, count);
      const local = (await deps.store.list(request.accountId, maxMessages)).slice(0, maxMessages);
      const plan = (deps.plan ?? planHistoryReconciliation)(local, boundedProvider, maxMessages);
      await deps.audit.record({ ...auditBase, result: 'success', metadata: { ...auditBase.metadata, providerMessages: boundedProvider.length, missing: plan.missing.length, existing: plan.existing.length, duplicates: plan.duplicates.length, truncated: plan.truncated } });
      return { plan };
    } catch (error) {
      await deps.audit.record({ ...auditBase, result: 'failure', metadata: { ...auditBase.metadata, error: error instanceof Error ? error.message : 'History reconciliation failed' } });
      throw error;
    }
  };
}
