import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresProviderQualificationStore } from '../src/provider-qualification-pg-store.js';

test('Postgres qualification store writes version-specific outcomes separately', async () => {
  let sql = '';
  let values: unknown[] = [];
  const timestamp = new Date('2026-02-03T04:05:06Z');
  const store = new PostgresProviderQualificationStore({
    async query(text, params = []) {
      sql = text; values = params;
      return { rows: [{ provider: 'napcat', version: '4.2.1', checks: JSON.parse(String(params[2])), recorded_at: timestamp }] };
    },
  });
  const saved = await store.record({ provider: ' NapCat ', version: '4.2.1', checks: [
    { id: 'outbound.private-text', status: 'pass', evidence: 'Observed test receipt' },
    { id: 'inbound.private-message', status: 'unverified' },
  ] });
  assert.match(sql, /INSERT INTO provider_qualification_results/);
  assert.match(sql, /ON CONFLICT \(provider, version\)/);
  assert.equal(values[0], 'napcat');
  assert.equal(saved.recordedAt, timestamp.toISOString());
  assert.equal(saved.checks[0]?.providerTested, true);
  assert.equal(saved.checks[0]?.status, 'pass');
});

test('Postgres qualification store reads by exact provider and version', async () => {
  let values: unknown[] = [];
  const store = new PostgresProviderQualificationStore({ async query(_sql, params = []) {
    values = params;
    return { rows: params[1] === '4.2.1' ? [{ provider: 'napcat', version: '4.2.1', checks: [{ id: 'outbound.private-text', status: 'pass', evidence: 'receipt', providerTested: true }], recorded_at: new Date('2026-02-03T04:05:06Z') }] : [] };
  } });
  const record = await store.get(' NapCat ', ' 4.2.1 ');
  assert.deepEqual(values, ['napcat', '4.2.1']);
  assert.equal(record?.version, '4.2.1');
  assert.equal(await store.get('napcat', '4.2.2'), undefined);
});

test('invalid qualifications are rejected before issuing SQL', async () => {
  let calls = 0;
  const store = new PostgresProviderQualificationStore({ async query() { calls++; return { rows: [] }; } });
  await assert.rejects(() => store.record({ provider: 'napcat', version: '4.2.1', checks: [{ id: 'outbound.private-text', status: 'pass' }] }));
  assert.equal(calls, 0);
});
