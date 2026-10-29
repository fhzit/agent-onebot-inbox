import type { NormalizedMessage } from './normalize.js';

export const MAX_RECONCILIATION_MESSAGES = 2_000;
export type ReconciliationMatch = { accountId: string; conversationId: string; messageId: string | null; fingerprint: string };
export type HistoryReconciliationPlan = {
  existing: ReconciliationMatch[];
  missing: ReconciliationMatch[];
  duplicates: ReconciliationMatch[];
  truncated: boolean;
};

/** Build a bounded, read-only comparison. It never imports or mutates messages. */
export function planHistoryReconciliation(
  local: readonly NormalizedMessage[],
  provider: readonly NormalizedMessage[],
  maxMessages = MAX_RECONCILIATION_MESSAGES,
): HistoryReconciliationPlan {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1) throw new Error('maxMessages must be a positive safe integer');
  const truncated = local.length > maxMessages || provider.length > maxMessages;
  const locals = local.slice(0, maxMessages);
  const fetched = provider.slice(0, maxMessages);
  const key = (m: NormalizedMessage) => `${m.account_id}\0${m.conversation_id}\0${m.external_message_id ? `id:${m.external_message_id}` : `fp:${m.event_fingerprint}`}`;
  const toMatch = (m: NormalizedMessage): ReconciliationMatch => ({ accountId: m.account_id, conversationId: m.conversation_id, messageId: m.external_message_id, fingerprint: m.event_fingerprint });
  const localKeys = new Set(locals.map(key));
  const providerKeys = new Set(fetched.map(key));
  const seenProvider = new Set<string>();
  const duplicates: ReconciliationMatch[] = [];
  for (const message of fetched) {
    const k = key(message);
    if (seenProvider.has(k)) duplicates.push(toMatch(message));
    seenProvider.add(k);
  }
  return {
    existing: fetched.filter(m => localKeys.has(key(m))).map(toMatch),
    missing: fetched.filter(m => !localKeys.has(key(m))).map(toMatch),
    duplicates,
    truncated,
  };
}
