import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProviderQualificationInput, validateQualificationEvidence } from '../src/provider-qualification-validation.js';

const check = { id: 'outbound.private-text', status: 'pass', evidence: 'Observed controlled send' };

test('requires non-empty evidence for pass/fail and permits absent evidence only for unverified', () => {
  for (const evidence of ['', '  \n\t']) {
    assert.throws(() => validateQualificationEvidence({ ...check, evidence }), /evidence/i);
  }
  assert.throws(() => validateQualificationEvidence({ id: check.id, status: 'fail' }), /evidence/i);
  assert.deepEqual(validateQualificationEvidence({ id: check.id, status: 'unverified' }), { id: check.id, status: 'unverified' });
});

test('rejects oversized evidence and control characters, accepts ordinary operator text', () => {
  assert.throws(() => validateQualificationEvidence({ ...check, evidence: 'x'.repeat(8193) }), /too long/i);
  assert.throws(() => validateQualificationEvidence({ ...check, evidence: 'line\u0000break' }), /control/i);
  assert.throws(() => validateQualificationEvidence({ ...check, evidence: 'line\u0085break' }), /control/i);
  assert.equal(validateQualificationEvidence(check).evidence, check.evidence);
});

test('rejects duplicate, unknown, and malformed checks without returning a partial result', () => {
  assert.throws(() => validateProviderQualificationInput({ provider: 'napcat', version: '1.2', checks: [check, check] }), /duplicate/i);
  assert.throws(() => validateProviderQualificationInput({ provider: 'napcat', version: '1.2', checks: [{ ...check, id: 'unknown' }] }), /unknown/i);
  assert.throws(() => validateProviderQualificationInput({ provider: 'napcat', version: '1.2', checks: [{ ...check, status: 'maybe' }] }), /invalid/i);
});

test('normalizes provider and check id while rejecting invalid versions', () => {
  const result = validateProviderQualificationInput({ provider: ' NapCat ', version: ' 1.2.3 ', checks: [{ ...check, id: ` ${check.id} ` }] });
  assert.equal(result.provider, 'napcat');
  assert.equal(result.version, '1.2.3');
  assert.equal(result.checks[0]?.id, check.id);
  for (const version of ['', 'x'.repeat(129), '1.0\u0001']) {
    assert.throws(() => validateProviderQualificationInput({ provider: 'napcat', version, checks: [] }), /version/i);
  }
  assert.throws(() => validateProviderQualificationInput({ provider: 'napcat', version: 1, checks: [] }), /include/i);
});
