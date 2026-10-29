import test from 'node:test';
import assert from 'node:assert/strict';
import { planHistoryReconciliation } from '../src/history-reconciliation-planner.js';
import type { NormalizedMessage } from '../src/normalize.js';

const message = (id: string, account = 'a', conversation = 'c', external: string | null = id, fingerprint = `fp-${id}`) => ({
  id, account_id: account, conversation_id: conversation, external_message_id: external, event_fingerprint: fingerprint,
} as NormalizedMessage);

test('reconciliation separates existing, missing and duplicate provider records', () => {
  const plan = planHistoryReconciliation([message('local')], [message('local'), message('new'), message('new-copy', 'a', 'c', 'new')]);
  assert.equal(plan.existing.length, 1);
  assert.equal(plan.missing.length, 2);
  assert.equal(plan.duplicates.length, 1);
  assert.deepEqual(plan.missing[0], { accountId: 'a', conversationId: 'c', messageId: 'new', fingerprint: 'fp-new' });
});

test('matching never crosses account or conversation boundaries', () => {
  const local = [message('one', 'a', 'c', 'same')];
  const provider = [message('two', 'b', 'c', 'same'), message('three', 'a', 'other', 'same')];
  assert.equal(planHistoryReconciliation(local, provider).existing.length, 0);
  assert.equal(planHistoryReconciliation(local, provider).missing.length, 2);
});

test('messages without external IDs match only by fingerprint in same boundary', () => {
  const result = planHistoryReconciliation([message('local', 'a', 'c', null, 'stable')], [message('provider', 'a', 'c', null, 'stable')]);
  assert.equal(result.existing.length, 1);
  assert.equal(result.missing.length, 0);
});

test('planner bounds both inputs and reports truncation; invalid bounds fail closed', () => {
  const result = planHistoryReconciliation([], [message('1'), message('2')], 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.truncated, true);
  assert.throws(() => planHistoryReconciliation([], [], 0), /positive safe integer/);
});
