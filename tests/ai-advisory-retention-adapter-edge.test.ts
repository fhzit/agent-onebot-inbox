import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAiAdvisoryRetentionRepository } from '../src/ai-advisory-retention-adapter.js';

function mockDb(rows: unknown[] = [], rowCount: number | null = 0) {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    db: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return { rows, rowCount };
      },
    },
  };
}

test('listExpired rejects invalid and ambiguous timestamps before querying', async () => {
  const { db, calls } = mockDb();
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  for (const before of ['not-a-date', '']) {
    await assert.rejects(() => repository.listExpired({ accountId: 'acct', before, limit: 1 }), /valid timestamp/);
  }
  assert.equal(calls.length, 0);
});

test('listExpired accepts UTC and offset timestamps and parameterizes exact values', async () => {
  const { db, calls } = mockDb();
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  for (const before of ['2025-01-02T03:04:05Z', '2025-01-02T03:04:05+02:00']) {
    await repository.listExpired({ accountId: 'acct', before, limit: 1 });
  }
  assert.deepEqual(calls.map(call => call.values), [
    ['acct', '2025-01-02T03:04:05Z', 1],
    ['acct', '2025-01-02T03:04:05+02:00', 1],
  ]);
  assert.ok(calls.every(call => call.text.includes('created_at < $2::timestamptz')));
});

test('listExpired rejects zero, fractional, and above-maximum limits without SQL', async () => {
  const { db, calls } = mockDb();
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  for (const limit of [0, 1.5, 501]) {
    await assert.rejects(() => repository.listExpired({ accountId: 'acct', before: '2025-01-01T00:00:00Z', limit }), /integer between 1 and 500/);
  }
  assert.equal(calls.length, 0);
});

test('listExpired accepts limits at both boundaries and binds rather than interpolates them', async () => {
  const { db, calls } = mockDb();
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  for (const limit of [1, 500]) await repository.listExpired({ accountId: 'acct', before: '2025-01-01T00:00:00Z', limit });
  assert.deepEqual(calls.map(call => call.values), [
    ['acct', '2025-01-01T00:00:00Z', 1],
    ['acct', '2025-01-01T00:00:00Z', 500],
  ]);
  assert.ok(calls.every(call => /LIMIT \$3/.test(call.text) && !/LIMIT\s+(?:1|500)\b/.test(call.text)));
});

test('listExpired rejects malformed timestamps returned by the database', async () => {
  const { db, calls } = mockDb([{ account_id: 'acct', message_id: 'm', policy_version: 'v1', created_at: 'invalid' }]);
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  await assert.rejects(() => repository.listExpired({ accountId: 'acct', before: '2025-01-01T00:00:00Z', limit: 1 }), /database returned invalid advisory timestamp/);
  assert.equal(calls.length, 1);
});

test('deleteAdvisories rejects account mismatch without SQL', async () => {
  const { db, calls } = mockDb();
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  await assert.rejects(() => repository.deleteAdvisories({ accountId: 'acct', records: [{ accountId: 'other', messageId: 'm', policyVersion: 'v1' }] }), /match accountId/);
  assert.equal(calls.length, 0);
});

test('deleteAdvisories supports exactly 500 identities and binds every SQL value', async () => {
  const records = Array.from({ length: 500 }, (_, index) => ({ accountId: 'acct', messageId: `m${index}`, policyVersion: `v${index}` }));
  const { db, calls } = mockDb([], 500);
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  assert.equal(await repository.deleteAdvisories({ accountId: 'acct', records }), 500);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.values?.length, 1001);
  assert.deepEqual(call.values?.slice(0, 5), ['acct', 'm0', 'v0', 'm1', 'v1']);
  assert.deepEqual(call.values?.slice(-2), ['m499', 'v499']);
  assert.match(call.text, /\$1000::text, \$1001::text/);
  assert.match(call.text, /advisory\.account_id = \$1/);
  assert.doesNotMatch(call.text, /m499|v499/);
});
