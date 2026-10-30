import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderQualificationStore } from '../src/provider-qualification-store.js';

test('stores independently versioned per-check outcomes without changing static checklist', () => {
  const store = new ProviderQualificationStore();
  const result = store.record({
    provider: ' NapCat ', version: '4.2.1', checks: [
      { id: 'outbound.private-text', status: 'pass', evidence: 'Controlled send observed' },
      { id: 'outbound.group-text', status: 'fail', evidence: 'Provider returned unsupported action' },
      { id: 'inbound.private-message', status: 'unverified' },
    ],
  });
  assert.equal(result.provider, 'napcat');
  assert.equal(result.version, '4.2.1');
  assert.equal(result.checks.length, 3);
  assert.equal(store.get('napcat', '4.2.1')?.checks[0]?.status, 'pass');
  assert.equal(store.get('napcat', '4.2.0'), undefined);
  assert.equal(store.get('napcat', '4.2.1')?.checks[0]?.providerTested, true);
});

test('rejects malformed or unsupported qualification entries without partial writes', () => {
  const store = new ProviderQualificationStore();
  const base = { provider: 'napcat', version: '4.2.1' };
  assert.throws(() => store.record({ ...base, checks: [{ id: 'bad-id', status: 'pass', evidence: 'x' }] }));
  assert.throws(() => store.record({ ...base, checks: [{ id: 'outbound.private-text', status: 'pass' }] }));
  assert.throws(() => store.record({ ...base, checks: [{ id: 'outbound.private-text', status: 'maybe' }] }));
  assert.equal(store.get('napcat', '4.2.1'), undefined);
});

test('returns immutable snapshots and overwrites only the same provider version', () => {
  const store = new ProviderQualificationStore();
  const input = { provider: 'napcat', version: '4.2.1', checks: [{ id: 'outbound.private-text', status: 'pass' as const, evidence: 'Observed' }] };
  const first = store.record(input);
  assert.throws(() => { (first.checks as unknown as Array<unknown>).push({}); });
  store.record({ ...input, checks: [{ id: 'outbound.private-text', status: 'fail', evidence: 'Observed failure' }] });
  store.record({ ...input, version: '4.2.2' });
  assert.equal(store.get('napcat', '4.2.1')?.checks[0]?.status, 'fail');
  assert.equal(store.get('napcat', '4.2.2')?.checks[0]?.status, 'pass');
});
