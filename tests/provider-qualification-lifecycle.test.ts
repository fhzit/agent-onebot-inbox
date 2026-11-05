import test from 'node:test';
import assert from 'node:assert/strict';
import { getQualificationLifecycleState, type QualificationLifecycleRecord } from '../src/provider-qualification-lifecycle.js';

const now = new Date('2026-01-10T00:00:00.000Z');
const checkIds = ['outbound.private-text', 'inbound.private-message'];
const base: QualificationLifecycleRecord = {
  provider: 'napcat', version: '1.2.3', recordedAt: '2026-01-01T00:00:00.000Z',
  checks: checkIds.map(id => ({ id, status: 'pass', providerTested: true, evidence: 'Observed against controlled test account' })),
};

test('qualification requires explicit passing, tested checks with evidence', () => {
  assert.equal(getQualificationLifecycleState(base, checkIds, now), 'qualified');
  assert.equal(getQualificationLifecycleState(undefined, checkIds, now), 'unverified');
  assert.equal(getQualificationLifecycleState({ ...base, checks: base.checks.map(c => ({ ...c, providerTested: false })) }, checkIds, now), 'unverified');
  assert.equal(getQualificationLifecycleState({ ...base, checks: [{ ...base.checks[0]!, evidence: ' ' }, base.checks[1]!] }, checkIds, now), 'unverified');
  assert.equal(getQualificationLifecycleState({ ...base, checks: [{ ...base.checks[0]!, status: 'unverified' }, base.checks[1]!] }, checkIds, now), 'unverified');
});

test('expired, malformed, future-dated, and absent expiry records never qualify', () => {
  assert.equal(getQualificationLifecycleState({ ...base, expiresAt: '2026-01-10T00:00:00.000Z' }, checkIds, now), 'expired');
  assert.equal(getQualificationLifecycleState({ ...base, expiresAt: 'not-a-date' }, checkIds, now), 'expired');
  assert.equal(getQualificationLifecycleState({ ...base, recordedAt: '2026-01-11T00:00:00.000Z' }, checkIds, now), 'unverified');
  assert.equal(getQualificationLifecycleState({ ...base, recordedAt: 'not-a-date' }, checkIds, now), 'unverified');
  assert.equal(getQualificationLifecycleState({ ...base, expiresAt: '2026-01-11T00:00:00.000Z' }, checkIds, now), 'qualified');
});

test('empty or duplicate required check lists fail closed', () => {
  assert.equal(getQualificationLifecycleState(base, [], now), 'unverified');
  assert.equal(getQualificationLifecycleState(base, ['outbound.private-text', 'outbound.private-text'], now), 'unverified');
});
