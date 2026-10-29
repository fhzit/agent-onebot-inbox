import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIncomingMessage } from '../src/ai-classification-ingress.js';

const message = { id: 'm-1', direction: 'incoming' as const, plain_text: 'hello there' };
const options = { enabled: true, labels: ['greeting', 'other'] };

test('requires explicit opt-in and an injected classifier', async () => {
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'greeting', confidence: 0.99 }; } };
  assert.equal(await classifyIncomingMessage(message, undefined, classifier), undefined);
  assert.equal(await classifyIncomingMessage(message, { ...options, enabled: false }, classifier), undefined);
  assert.equal(await classifyIncomingMessage(message, options, undefined), undefined);
  assert.equal(calls, 0);
});

test('classifies bounded incoming normalized text as advisory result only', async () => {
  const seen: unknown[] = [];
  const classifier = { async classify(input: unknown) { seen.push(input); return { label: 'greeting', confidence: 0.9 }; } };
  assert.deepEqual(await classifyIncomingMessage(message, options, classifier), { label: 'greeting', confidence: 0.9 });
  assert.deepEqual(seen, [{ messageId: 'm-1', text: 'hello there', labels: ['greeting', 'other'] }]);
  assert.deepEqual(message, { id: 'm-1', direction: 'incoming', plain_text: 'hello there' });
});

test('skips outbound, blank, oversized, and short text without provider calls', async () => {
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'greeting', confidence: 1 }; } };
  assert.equal(await classifyIncomingMessage({ ...message, direction: 'outgoing' }, options, classifier), undefined);
  assert.equal(await classifyIncomingMessage({ ...message, plain_text: '  ' }, options, classifier), undefined);
  assert.equal(await classifyIncomingMessage({ ...message, plain_text: 'x'.repeat(8_001) }, options, classifier), undefined);
  assert.equal(await classifyIncomingMessage(message, { ...options, minTextChars: 20 }, classifier), undefined);
  assert.equal(calls, 0);
});

test('abstains on invalid labels, low confidence, malformed results, and provider errors', async () => {
  const classifier = (value: unknown) => ({ async classify() { return value; } });
  assert.equal(await classifyIncomingMessage(message, options, classifier({ label: 'unknown', confidence: 0.99 })), undefined);
  assert.equal(await classifyIncomingMessage(message, options, classifier({ label: 'greeting', confidence: 0.2 })), undefined);
  assert.equal(await classifyIncomingMessage(message, options, classifier(null)), undefined);
  assert.equal(await classifyIncomingMessage(message, options, { async classify() { throw new Error('offline'); } }), undefined);
});

test('invalid policy bounds abstain without provider invocation', async () => {
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'greeting', confidence: 1 }; } };
  assert.equal(await classifyIncomingMessage(message, { ...options, minTextChars: 0 }, classifier), undefined);
  assert.equal(await classifyIncomingMessage(message, { ...options, threshold: 2 }, classifier), undefined);
  assert.equal(await classifyIncomingMessage(message, { ...options, labels: [] }, classifier), undefined);
  assert.equal(await classifyIncomingMessage(message, { ...options, labels: ['same', 'same'] }, classifier), undefined);
  assert.equal(await classifyIncomingMessage({ ...message, id: 'x'.repeat(257) }, options, classifier), undefined);
  assert.equal(calls, 0);
});

test('opt-in redaction removes common sensitive values before provider dispatch', async () => {
  const text = 'Email me at alice@example.com, call +1 (212) 555-0199, visit https://example.com and token=abc123';
  let input: unknown;
  const classifier = { async classify(value: unknown) { input = value; return { label: 'other', confidence: 0.99 }; } };
  await classifyIncomingMessage({ ...message, plain_text: text }, { ...options, redactSensitive: true }, classifier);
  assert.deepEqual(input, {
    messageId: 'm-1',
    text: 'Email me at [REDACTED_EMAIL], call [REDACTED_PHONE], visit [REDACTED_URL] and [REDACTED_SECRET]',
    labels: ['greeting', 'other'],
  });
});
