import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAiAdvisoryStore } from '../src/ai-advisory-store.js';

const row = { account_id: 'acct', message_id: 'msg', label: 'urgent', confidence: 0.91, model: 'model-x', policy_version: 'v1', created_at: new Date('2026-01-01T00:00:00Z') };
function poolFor(finalRows: unknown[] = [row]) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const client = { async query<T = Record<string, unknown>>(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: (sql.startsWith('INSERT') ? finalRows : []) as T[] }; }, release() { calls.push({ sql: 'RELEASE' }); } };
  return { calls, pool: { async connect() { return client; }, async query<T = Record<string, unknown>>(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: [] as T[] }; } } };
}
const input = { accountId: 'acct', messageId: 'msg', label: 'urgent', confidence: 0.91, model: 'model-x', policyVersion: 'v1', expectedConsentRevision: 2 };

test('record persists metadata inside transaction guarded by enabled consent revision', async () => {
  const { calls, pool } = poolFor();
  const store = new PostgresAiAdvisoryStore(pool);
  const result = await store.record(input);
  assert.deepEqual(result, { accountId: 'acct', messageId: 'msg', label: 'urgent', confidence: 0.91, model: 'model-x', policyVersion: 'v1', createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(calls[0]?.sql, 'BEGIN');
  const insert = calls.find(call => call.sql.startsWith('INSERT'))!;
  assert.match(insert.sql, /ON CONFLICT \(account_id, message_id, policy_version\) DO UPDATE/);
  assert.match(insert.sql, /FROM messages WHERE account_id = \$1 AND id = \$2/);
  assert.match(insert.sql, /FROM ai_advisory_consent WHERE account_id = \$1 AND enabled = TRUE AND revision = \$7\s+FOR UPDATE/);
  assert.doesNotMatch(insert.sql, /reason|plain_text|raw_result/);
  assert.deepEqual(insert.values, ['acct', 'msg', 'urgent', 0.91, 'model-x', 'v1', 2]);
  assert.equal(calls.at(-2)?.sql, 'COMMIT');
  assert.equal(calls.at(-1)?.sql, 'RELEASE');
});

test('revoke between final precheck and persistence makes stale revision insert no-op', async () => {
  const { calls, pool } = poolFor([]); // consent revision changed before the transaction executes its guarded insert
  const store = new PostgresAiAdvisoryStore(pool);
  await assert.rejects(() => store.record(input), /current consent revision/);
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT')).length, 1);
  assert.equal(calls.at(-2)?.sql, 'ROLLBACK');
  assert.equal(calls.at(-1)?.sql, 'RELEASE');
});

test('record fails closed without a transaction-capable pool', async () => {
  const store = new PostgresAiAdvisoryStore({ async query() { return { rows: [row] }; } });
  await assert.rejects(() => store.record(input), /transaction-capable/);
});

test('list remains account-scoped, bounded and uses a composite keyset cursor', async () => {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const store = new PostgresAiAdvisoryStore({ async query(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: [] }; } });
  assert.deepEqual(await store.list('acct', { before: '2026-01-01T00:00:00.000Z', beforeMessageId: 'message:custom-id/42', limit: 100 }), []);
  assert.match(calls[0]!.sql, /WHERE account_id = \$1/);
  assert.match(calls[0]!.sql, /\(created_at, message_id\) < \(\$2::timestamptz, \$3::text\)/);
  assert.match(calls[0]!.sql, /ORDER BY created_at DESC, message_id DESC LIMIT \$4/);
  assert.deepEqual(calls[0]!.values, ['acct', '2026-01-01T00:00:00.000Z', 'message:custom-id/42', 100]);
});

test('rejects invalid filters, excessive limits and malformed input before SQL', async () => {
  let calls = 0;
  const { pool } = poolFor();
  const store = new PostgresAiAdvisoryStore({ ...pool, async query() { calls++; return { rows: [] }; } });
  await assert.rejects(() => store.list('acct', { limit: 101 }), RangeError);
  await assert.rejects(() => store.list('acct', { before: '2026-01-01' }), /supplied together/);
  await assert.rejects(() => store.list('acct', { before: 'bad', beforeMessageId: 'msg' }), /valid timestamp/);
  await assert.rejects(() => store.list(' acct'), /accountId/);
  await assert.rejects(() => store.record({ ...input, confidence: 1.1 }));
  await assert.rejects(() => store.record({ ...input, accountId: 'a ' }));
  await assert.rejects(() => store.record({ ...input, expectedConsentRevision: 0 }));
  assert.equal(calls, 0);
});
