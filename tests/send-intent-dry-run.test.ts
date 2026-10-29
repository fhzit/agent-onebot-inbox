import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEND_INTENT_MAX_SEGMENTS, validateSendIntentDryRun } from '../src/send-intent-dry-run.js';

test('dry-run validates explicit private and group intents without provider effects', () => {
  assert.deepEqual(validateSendIntentDryRun({ accountId: ' acct-1 ', type: 'private', targetId: ' user-2 ', message: 'hello' }), {
    valid: true, providerEffects: false, accountId: 'acct-1', type: 'private', targetId: 'user-2', segmentCount: 1,
  });
  assert.deepEqual(validateSendIntentDryRun({ accountId: 'acct-1', type: 'group', targetId: 'group-3', message: [{ type: 'text', data: { text: 'hello' } }] }), {
    valid: true, providerEffects: false, accountId: 'acct-1', type: 'group', targetId: 'group-3', segmentCount: 1,
  });
});

test('dry-run refuses missing account, invalid target kind, and ambiguous targets', () => {
  const base = { accountId: 'acct', type: 'private' as const, targetId: 'user', message: 'hello' };
  assert.throws(() => validateSendIntentDryRun({ ...base, accountId: '  ' }), /explicit account/);
  assert.throws(() => validateSendIntentDryRun({ ...base, type: 'other' as 'private' }), /private or group/);
  for (const targetId of ['', 'user one', 'user,other', 'user;other']) {
    assert.throws(() => validateSendIntentDryRun({ ...base, targetId }), /explicit|Ambiguous/);
  }
});

test('dry-run enforces nonempty well-formed messages and segment limit', () => {
  const base = { accountId: 'acct', type: 'group' as const, targetId: 'group', message: 'hello' };
  assert.throws(() => validateSendIntentDryRun({ ...base, message: [] }), /at least one segment/);
  assert.throws(() => validateSendIntentDryRun({ ...base, message: Array.from({ length: SEND_INTENT_MAX_SEGMENTS + 1 }, () => ({ type: 'text', data: { text: 'x' } })) }), /segment limit/);
  assert.throws(() => validateSendIntentDryRun({ ...base, message: [{ type: '', data: {} }] }), /type and data/);
  assert.equal(validateSendIntentDryRun({ ...base, message: Array.from({ length: SEND_INTENT_MAX_SEGMENTS }, () => ({ type: 'text', data: { text: 'x' } })) }).segmentCount, SEND_INTENT_MAX_SEGMENTS);
});
