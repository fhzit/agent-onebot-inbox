import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcilePendingSend } from '../src/send-idempotency-reconcile.js';

const claim = { accountId: 'acct', requestId: 'req-1', messageType: 'private' as const, targetId: 'user-7', payload: [{ type: 'text', data: { text: 'hello' } }], state: 'pending' as const };
const message = { account_id: 'acct', client_request_id: 'req-1', direction: 'outgoing', conversation_id: 'acct:private:user-7', raw_message: claim.payload };

test('matches saved outgoing row for the exact pending request', () => {
  assert.deepEqual(reconcilePendingSend(claim, message), { status: 'matched', message });
});

test('reports absent saved row without retrying', () => {
  assert.deepEqual(reconcilePendingSend(claim, null), { status: 'not-found' });
});

test('does not reconcile completed claims', () => {
  assert.deepEqual(reconcilePendingSend({ ...claim, state: 'complete' }, message), { status: 'not-pending' });
});

test('detects identity, direction, target, and payload mismatches', () => {
  const variants = [
    [{ ...message, account_id: 'other' }, 'account'],
    [{ ...message, client_request_id: 'other' }, 'request-id'],
    [{ ...message, direction: 'incoming' }, 'direction'],
    [{ ...message, conversation_id: 'acct:group:user-7' }, 'target'],
    [{ ...message, raw_message: 'different' }, 'payload'],
  ] as const;
  for (const [row, reason] of variants) assert.deepEqual(reconcilePendingSend(claim, row), { status: 'mismatch', reason });
});
