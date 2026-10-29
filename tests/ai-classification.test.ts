import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, MAX_CLASSIFICATION_TEXT_CHARS, type MessageClassifier } from '../src/ai-classification.js';

const adapter = (result: unknown, capture?: (input: unknown) => void): MessageClassifier => ({
  async classify(input) { capture?.(input); return result; },
});

test('passes bounded, normalized inputs to an adapter and validates its result', async () => {
  let received: unknown;
  const actual = await classifyMessage(adapter({ label: 'urgent', confidence: 0.82, reason: 'asks for today' }, input => { received = input; }), {
    messageId: ' msg-1 ', text: 'Please do this today', labels: ['urgent', 'later'],
  });
  assert.deepEqual(received, { messageId: 'msg-1', text: 'Please do this today', labels: ['urgent', 'later'] });
  assert.deepEqual(actual, { label: 'urgent', confidence: 0.82, reason: 'asks for today' });
});

test('rejects oversized or malformed input before calling the adapter', async () => {
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'x', confidence: 1 }; } };
  await assert.rejects(classifyMessage(classifier, { messageId: 'id', text: 'x'.repeat(MAX_CLASSIFICATION_TEXT_CHARS + 1), labels: ['x'] }), RangeError);
  await assert.rejects(classifyMessage(classifier, { messageId: 'id', text: '', labels: [] }), RangeError);
  await assert.rejects(classifyMessage(classifier, { messageId: 'id', text: '', labels: ['x', 'x'] }), /unique/);
  assert.equal(calls, 0);
});

test('rejects invalid adapter labels, confidence, and oversized reason', async () => {
  const input = { messageId: 'id', text: '', labels: ['valid'] };
  await assert.rejects(classifyMessage(adapter({ label: 'other', confidence: 1 }), input), /unknown label/);
  await assert.rejects(classifyMessage(adapter({ label: 'valid', confidence: NaN }), input), /confidence/);
  await assert.rejects(classifyMessage(adapter({ label: 'valid', confidence: 1, reason: 'r'.repeat(241) }), input), /reason/);
});
