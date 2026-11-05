import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistIncomingAiAdvisory } from '../src/ai-advisory-runtime.js';

const message = { id: 'msg-1', account_id: 'acct-1', direction: 'incoming' as const, plain_text: 'private body must not be stored' };
const policy = { enabled: true, accountId: 'acct-1', labels: ['support', 'other'], model: 'model-1', policyVersion: 'policy-1' };
const advisory = { accountId: 'acct-1', messageId: 'msg-1', label: 'support', confidence: 0.94, model: 'model-1', policyVersion: 'policy-1', createdAt: '2026-01-01T00:00:00.000Z' };

test('classifies and persists exactly once for a newly inserted incoming message, metadata only', async () => {
  const classifierCalls: unknown[] = [];
  const storeCalls: unknown[] = [];
  const classifier = { async classify(input: unknown) { classifierCalls.push(input); return { label: 'support', confidence: 0.94, reason: 'quotes private body must not be stored' }; } };
  const store = { async record(input: unknown) { storeCalls.push(input); return advisory; } };
  assert.deepEqual(await persistIncomingAiAdvisory(message, true, policy, classifier, store), advisory);
  assert.equal(classifierCalls.length, 1);
  assert.equal(storeCalls.length, 1);
  assert.deepEqual(storeCalls[0], { accountId: 'acct-1', messageId: 'msg-1', label: 'support', confidence: 0.94, model: 'model-1', policyVersion: 'policy-1' });
  assert.equal(JSON.stringify(storeCalls[0]).includes(message.plain_text), false);
  assert.equal(JSON.stringify(storeCalls[0]).includes('quotes private body'), false);
});

test('does not classify or persist unless explicitly enabled and newly inserted incoming', async () => {
  let classifications = 0;
  let writes = 0;
  const classifier = { async classify() { classifications++; return { label: 'support', confidence: 1 }; } };
  const store = { async record() { writes++; return advisory; } };
  assert.equal(await persistIncomingAiAdvisory(message, false, policy, classifier, store), undefined);
  assert.equal(await persistIncomingAiAdvisory(message, true, { ...policy, enabled: false }, classifier, store), undefined);
  assert.equal(await persistIncomingAiAdvisory({ ...message, direction: 'outgoing' }, true, policy, classifier, store), undefined);
  assert.equal(await persistIncomingAiAdvisory(message, true, policy, undefined, store), undefined);
  assert.equal(await persistIncomingAiAdvisory(message, true, policy, classifier, undefined), undefined);
  assert.deepEqual([classifications, writes], [0, 0]);
});

test('classifier failures and invalid results fail open without store writes', async () => {
  let writes = 0;
  const store = { async record() { writes++; return advisory; } };
  assert.equal(await persistIncomingAiAdvisory(message, true, policy, { async classify() { throw new Error('offline'); } }, store), undefined);
  assert.equal(await persistIncomingAiAdvisory(message, true, policy, { async classify() { return { label: 'unknown', confidence: 1 }; } }, store), undefined);
  assert.equal(writes, 0);
});

test('storage failures fail open after one validated classifier call', async () => {
  let classifications = 0;
  let writes = 0;
  const result = await persistIncomingAiAdvisory(message, true, policy, {
    async classify() { classifications++; return { label: 'support', confidence: 0.9 }; },
  }, { async record() { writes++; throw new Error('database unavailable'); } });
  assert.equal(result, undefined);
  assert.deepEqual([classifications, writes], [1, 1]);
});

test('explicit account/model/policy identifiers are required before classification', async () => {
  let classifications = 0;
  const classifier = { async classify() { classifications++; return { label: 'support', confidence: 1 }; } };
  const store = { async record() { return advisory; } };
  assert.equal(await persistIncomingAiAdvisory(message, true, { ...policy, accountId: ' ' }, classifier, store), undefined);
  assert.equal(classifications, 0);
});
