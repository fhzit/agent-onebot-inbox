import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichMessageClassification } from '../src/ai-classification-runtime.js';

const message = { id: 'm-1', direction: 'incoming', plain_text: 'hello there' };
const policy = { enabled: true, labels: ['greeting', 'other'] };

test('runtime policy is explicit opt-in; disabled or absent config makes zero classifier calls', async () => {
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'greeting', confidence: 1 }; } };
  assert.equal(await enrichMessageClassification(message, undefined, classifier), undefined);
  assert.equal(await enrichMessageClassification(message, { ...policy, enabled: false }, classifier), undefined);
  assert.equal(await enrichMessageClassification(message, policy, undefined), undefined);
  assert.equal(calls, 0);
});

test('opted-in policy classifies incoming content once and returns validated advisory result', async () => {
  const received: unknown[] = [];
  const classifier = { async classify(input: unknown) { received.push(input); return { label: 'greeting', confidence: 0.9 }; } };
  assert.deepEqual(await enrichMessageClassification(message, policy, classifier), { label: 'greeting', confidence: 0.9 });
  assert.deepEqual(received, [{ messageId: 'm-1', text: 'hello there', labels: ['greeting', 'other'] }]);
});

test('filters outbound, blank, short, and explicitly excluded messages without provider calls', async () => {
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'greeting', confidence: 1 }; } };
  assert.equal(await enrichMessageClassification({ ...message, direction: 'outgoing' }, policy, classifier), undefined);
  assert.equal(await enrichMessageClassification({ ...message, plain_text: '  ' }, policy, classifier), undefined);
  assert.equal(await enrichMessageClassification(message, { ...policy, minTextChars: 20 }, classifier), undefined);
  assert.equal(await enrichMessageClassification(message, { ...policy, shouldClassify: () => false }, classifier), undefined);
  assert.equal(calls, 0);
});

test('provider or output failures fail open and do not block ingress', async () => {
  assert.equal(await enrichMessageClassification(message, policy, { async classify() { throw new Error('offline'); } }), undefined);
  assert.equal(await enrichMessageClassification(message, policy, { async classify() { return { label: 'unknown', confidence: 3 }; } }), undefined);
});

test('rejects invalid threshold without contacting classifier', async () => {
  let calls = 0;
  await assert.rejects(enrichMessageClassification(message, { ...policy, minTextChars: 0 }, { async classify() { calls++; return {}; } }), /minTextChars/);
  assert.equal(calls, 0);
});
