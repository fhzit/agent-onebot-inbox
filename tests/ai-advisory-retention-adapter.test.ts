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

test('listExpired queries only old advisory metadata for one account, oldest first, with a cap', async () => {
  const { db, calls } = mockDb([{
    account_id: 'acct', message_id: 'm1', policy_version: 'v1', created_at: '2025-01-01T00:00:00Z',
  }]);
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  assert.deepEqual(await repository.listExpired({ accountId: 'acct', before: '2025-06-01T00:00:00Z', limit: 25 }), [
    { accountId: 'acct', messageId: 'm1', policyVersion: 'v1', createdAt: '2025-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(calls[0].values, ['acct', '2025-06-01T00:00:00Z', 25]);
  assert.match(calls[0].text, /created_at < \$2::timestamptz/);
  assert.match(calls[0].text, /ORDER BY created_at ASC/);
  assert.match(calls[0].text, /LIMIT \$3/);
  assert.match(calls[0].text, /FROM ai_advisories/);
  assert.doesNotMatch(calls[0].text, /FROM messages|message_text/i);
});

test('delete is identity-bound, account-scoped, parameterized, and reports affected count', async () => {
  const { db, calls } = mockDb([], 1);
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  assert.equal(await repository.deleteAdvisories({ accountId: 'acct', records: [
    { accountId: 'acct', messageId: "m'1", policyVersion: 'v1' },
    { accountId: 'acct', messageId: 'm2', policyVersion: 'v2' },
  ] }), 1);
  assert.match(calls[0].text, /^\s*DELETE FROM ai_advisories/);
  assert.match(calls[0].text, /advisory\.account_id = \$1/);
  assert.doesNotMatch(calls[0].text, /DELETE FROM messages/i);
  assert.deepEqual(calls[0].values, ['acct', "m'1", 'v1', 'm2', 'v2']);
});

test('empty delete does not query; oversized, mismatched, or duplicate identities are rejected without SQL', async () => {
  const { db, calls } = mockDb();
  const repository = new PostgresAiAdvisoryRetentionRepository(db);
  assert.equal(await repository.deleteAdvisories({ accountId: 'acct', records: [] }), 0);
  await assert.rejects(() => repository.deleteAdvisories({ accountId: 'acct', records: Array.from({ length: 501 }, (_, i) => ({ accountId: 'acct', messageId: `m${i}`, policyVersion: 'v1' })) }), /at most/);
  await assert.rejects(() => repository.deleteAdvisories({ accountId: 'acct', records: [{ accountId: 'other', messageId: 'm', policyVersion: 'v1' }] }), /match accountId/);
  await assert.rejects(() => repository.deleteAdvisories({ accountId: 'acct', records: [
    { accountId: 'acct', messageId: 'm', policyVersion: 'v1' },
    { accountId: 'acct', messageId: 'm', policyVersion: 'v1' },
  ] }), /duplicate/);
  assert.equal(calls.length, 0);
});
