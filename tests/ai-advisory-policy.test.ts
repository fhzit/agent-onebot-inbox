import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistAiAdvisoryIfAllowed } from '../src/ai-advisory-policy.js';

const classified = { label: 'urgent', confidence: 0.91, reason: 'contains private explanation' };
const options = {
  consent: { enabled: true as const, accountId: 'acct-1' },
  messageId: 'message-1', newlyInserted: true, allowedLabels: ['urgent', 'later'], model: 'model-1',
};

test('persists metadata only for opted-in, newly inserted, valid classifications', async () => {
  const writes: unknown[] = [];
  const result = await persistAiAdvisoryIfAllowed(classified, options, input => writes.push(input));
  assert.equal(result, true);
  assert.deepEqual(writes, [{
    accountId: 'acct-1', messageId: 'message-1', label: 'urgent', confidence: 0.91,
    model: 'model-1', policyVersion: 'ai-advisory-v1',
  }]);
  assert.equal(JSON.stringify(writes).includes('private explanation'), false);
});

test('disabled or absent opt-in never invokes persistence', async () => {
  const writes: unknown[] = [];
  const persist = (input: unknown) => { writes.push(input); };
  assert.equal(await persistAiAdvisoryIfAllowed(classified, { ...options, consent: undefined }, persist), false);
  assert.equal(await persistAiAdvisoryIfAllowed(classified, { ...options, consent: { enabled: false, accountId: 'acct-1' } as never }, persist), false);
  assert.deepEqual(writes, []);
});

test('abstain, invalid results, and deduplicated messages never invoke persistence', async () => {
  const writes: unknown[] = [];
  const persist = (input: unknown) => { writes.push(input); };
  assert.equal(await persistAiAdvisoryIfAllowed({ label: 'urgent', confidence: 0.2 }, options, persist), false);
  assert.equal(await persistAiAdvisoryIfAllowed({ label: 'not-allowed', confidence: 1 }, options, persist), false);
  assert.equal(await persistAiAdvisoryIfAllowed(null, options, persist), false);
  assert.equal(await persistAiAdvisoryIfAllowed(classified, { ...options, newlyInserted: false }, persist), false);
  assert.deepEqual(writes, []);
});

test('invalid persistence context fails closed', async () => {
  const writes: unknown[] = [];
  assert.equal(await persistAiAdvisoryIfAllowed(classified, { ...options, messageId: ' ' }, input => writes.push(input)), false);
  assert.equal(await persistAiAdvisoryIfAllowed(classified, { ...options, model: '' }, input => writes.push(input)), false);
  assert.deepEqual(writes, []);
});
