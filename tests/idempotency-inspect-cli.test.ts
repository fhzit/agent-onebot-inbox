import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectPendingIdempotency, runIdempotencyInspectCli } from '../src/idempotency-inspect-cli.js';

function fakeDb() {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const rows = [
    { account_id: 'acct', client_request_id: 'req-1', message_type: 'private' as const, state: 'pending' as const, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z', payload: 'secret payload', response: 'secret response', target_id: 'secret target' },
  ];
  return {
    queries,
    db: { async query(sql: string, values: unknown[] = []) { queries.push({ sql, values }); return { rows: rows as never[] }; } },
  };
}

test('reports only sanitized pending metadata and never selects sensitive columns', async () => {
  const { db, queries } = fakeDb();
  const report = await inspectPendingIdempotency(db, { accountId: 'acct', limit: 10 });
  assert.deepEqual(report, { count: 1, claims: [{ accountId: 'acct', requestId: 'req-1', messageType: 'private', state: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' }] });
  assert.match(queries[0]!.sql, /state='pending'/);
  assert.doesNotMatch(queries[0]!.sql, /payload|response|target_id/i);
  assert.deepEqual(queries[0]!.values, ['acct', 10]);
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('CLI emits JSON report and validates bounded limit', async () => {
  const { db } = fakeDb(); let output = '';
  await runIdempotencyInspectCli(db, ['--limit', '5'], value => { output = value; });
  assert.equal(JSON.parse(output).count, 1);
  await assert.rejects(runIdempotencyInspectCli(db, ['--limit', '1001']), /limit must be an integer from 1 to 1000/);
  await assert.rejects(runIdempotencyInspectCli(db, ['--mutate']), /Unknown option/);
});
