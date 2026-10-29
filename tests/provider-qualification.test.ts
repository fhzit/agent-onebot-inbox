import test from 'node:test';
import assert from 'node:assert/strict';
import { isProviderCapabilityQualified, PROVIDER_QUALIFICATION_CHECKLIST } from '../src/provider-qualification.js';

test('NapCat and SnowLuma checklist covers inbound, outbound, and transport as unverified', () => {
  assert.deepEqual(Object.keys(PROVIDER_QUALIFICATION_CHECKLIST).sort(), ['napcat', 'snowluma']);
  for (const checks of Object.values(PROVIDER_QUALIFICATION_CHECKLIST)) {
    assert.ok(checks.some(check => check.direction === 'inbound'));
    assert.ok(checks.some(check => check.direction === 'outbound'));
    assert.ok(checks.some(check => check.direction === 'transport'));
    assert.ok(checks.every(check => check.verification === 'unverified'));
    assert.ok(checks.every(check => check.failClosed && check.requiredEvidence.length > 0));
  }
});

test('unverified, unknown provider, and unknown check all fail closed', () => {
  assert.equal(isProviderCapabilityQualified('napcat', 'outbound.private-text'), false);
  assert.equal(isProviderCapabilityQualified('snowluma', 'inbound.group-message'), false);
  assert.equal(isProviderCapabilityQualified('unknown', 'outbound.private-text'), false);
  assert.equal(isProviderCapabilityQualified('napcat', 'not-a-check'), false);
});

test('checklist is immutable at runtime', () => {
  assert.equal(Object.isFrozen(PROVIDER_QUALIFICATION_CHECKLIST), true);
  assert.equal(Object.isFrozen(PROVIDER_QUALIFICATION_CHECKLIST.napcat), true);
  assert.ok(PROVIDER_QUALIFICATION_CHECKLIST.napcat!.every(Object.isFrozen));
});
