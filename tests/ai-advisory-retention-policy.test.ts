import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ADVISORY_RETENTION_POLICY_VERSION,
  getAiAdvisoryRetentionCutoff,
  validateAiAdvisoryRetentionPolicy,
} from '../src/ai-advisory-retention-policy.js';

const valid = { version: AI_ADVISORY_RETENTION_POLICY_VERSION, retentionDays: 30, batchSize: 100 };

test('validates explicit policy and returns immutable normalized values', () => {
  const policy = validateAiAdvisoryRetentionPolicy(valid);
  assert.deepEqual(policy, valid);
  assert.equal(Object.isFrozen(policy), true);
});

test('fails closed for missing, malformed, unsupported, and out-of-range policy', () => {
  for (const invalid of [undefined, null, [], {}, { ...valid, version: '2' },
    { ...valid, retentionDays: undefined }, { ...valid, retentionDays: 0 },
    { ...valid, retentionDays: 3651 }, { ...valid, retentionDays: 1.5 },
    { ...valid, batchSize: undefined }, { ...valid, batchSize: 0 },
    { ...valid, batchSize: 501 }, { ...valid, batchSize: 1.5 }]) {
    assert.throws(() => validateAiAdvisoryRetentionPolicy(invalid));
  }
});

test('computes deterministic UTC cutoff without a policy default', () => {
  const policy = validateAiAdvisoryRetentionPolicy(valid);
  assert.equal(getAiAdvisoryRetentionCutoff(policy, new Date('2025-04-01T12:00:00.000Z')),
    '2025-03-02T12:00:00.000Z');
  assert.throws(() => getAiAdvisoryRetentionCutoff(policy, new Date('invalid')));
  assert.throws(() => getAiAdvisoryRetentionCutoff(undefined as never, new Date()));
});
