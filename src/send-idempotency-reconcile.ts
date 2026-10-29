export type PendingSendClaim = {
  accountId: string;
  requestId: string;
  messageType: 'private' | 'group';
  targetId: string;
  payload: unknown;
  state: 'pending' | 'complete';
};

export type PersistedOutgoingMessage = {
  account_id: string;
  client_request_id: string | null;
  direction: string;
  conversation_id: string;
  raw_message: unknown;
};

export type SendReconciliation =
  | { status: 'not-pending' }
  | { status: 'not-found' }
  | { status: 'mismatch'; reason: 'account' | 'request-id' | 'direction' | 'target' | 'payload' }
  | { status: 'matched'; message: PersistedOutgoingMessage };

/** Classify persisted evidence for a pending send; this never dispatches or retries. */
export function reconcilePendingSend(
  claim: PendingSendClaim,
  message: PersistedOutgoingMessage | null | undefined,
): SendReconciliation {
  if (claim.state !== 'pending') return { status: 'not-pending' };
  if (!message) return { status: 'not-found' };
  if (message.account_id !== claim.accountId) return { status: 'mismatch', reason: 'account' };
  if (message.client_request_id !== claim.requestId) return { status: 'mismatch', reason: 'request-id' };
  if (message.direction !== 'outgoing') return { status: 'mismatch', reason: 'direction' };
  if (message.conversation_id !== `${claim.accountId}:${claim.messageType}:${claim.targetId}`) return { status: 'mismatch', reason: 'target' };
  if (!sameJson(message.raw_message, claim.payload)) return { status: 'mismatch', reason: 'payload' };
  return { status: 'matched', message };
}

function sameJson(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
