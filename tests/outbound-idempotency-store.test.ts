import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresOutboundIdempotencyStore } from '../src/outbound-idempotency-store.js';

function fakePool() {
  const records = new Map<string, Record<string, unknown>>();
  const client = {
    async query(text: string, values: unknown[] = []) {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('UPDATE outbound_idempotency')) {
        const row = records.get(`${values[0]}:${values[1]}`);
        if (!row || row.state !== 'pending') return { rows: [], rowCount: 0 };
        row.state = 'complete'; row.response = JSON.parse(String(values[2]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT state,response')) {
        const row = records.get(`${values[0]}:${values[1]}`); return { rows: row ? [{ state: row.state, response: row.response }] : [] };
      }
      if (text.includes('INSERT INTO outbound_idempotency')) {
        const key = `${values[0]}:${values[1]}`;
        if (records.has(key)) return { rows: [] };
        const row = { account_id: values[0], client_request_id: values[1], message_type: values[2], target_id: values[3], payload: JSON.parse(String(values[4])), state: 'pending', response: null };
        records.set(key, row); return { rows: [row] };
      }
      if (text.includes('SELECT account_id,client_request_id')) {
        const row = records.get(`${values[0]}:${values[1]}`); return { rows: row ? [row] : [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }, release() {}
  };
  return { records, pool: { connect: async () => client, query: client.query } as never };
}
const request = { accountId: 'acct', requestId: 'request-1', messageType: 'private' as const, targetId: 'user-7', payload: [{ type: 'text', data: { text: 'hello' } }] };

test('durable ledger returns existing row for identical request', async () => {
  const { pool } = fakePool(); const store = new PostgresOutboundIdempotencyStore(pool);
  assert.equal((await store.claim(request)).created, true);
  const again = await store.claim(request);
  assert.equal(again.created, false);
  assert.deepEqual(again.record.payload, request.payload);
  assert.equal(again.record.state, 'pending');
});

test('durable ledger rejects request ID reused with different payload', async () => {
  const { pool } = fakePool(); const store = new PostgresOutboundIdempotencyStore(pool);
  await store.claim(request);
  await assert.rejects(() => store.claim({ ...request, payload: 'different' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('complete transitions pending rows and accepts an identical repeated completion', async () => {
  const { pool, records } = fakePool(); const store = new PostgresOutboundIdempotencyStore(pool);
  await store.claim(request);
  await store.complete(request.accountId, request.requestId, { ok: true });
  await store.complete(request.accountId, request.requestId, { ok: true });
  assert.equal(records.get('acct:request-1')?.state, 'complete');
});

test('complete rejects missing records and different repeated responses', async () => {
  const { pool } = fakePool(); const store = new PostgresOutboundIdempotencyStore(pool);
  await assert.rejects(store.complete('acct', 'missing', {}), /not found/);
  await store.claim(request);
  await store.complete(request.accountId, request.requestId, { ok: true });
  await assert.rejects(store.complete(request.accountId, request.requestId, { ok: false }), /response differs/);
});

test('claim preserves commit error if rollback also fails', async () => {
  const original = new Error('commit outcome unknown');
  const client = {
    async query(text: string) {
      if (text === 'COMMIT') throw original;
      if (text === 'ROLLBACK') throw new Error('rollback failed');
      if (text.includes('INSERT INTO')) return { rows: [{ account_id: 'acct', client_request_id: 'request-1', message_type: 'private', target_id: 'user-7', payload: request.payload, state: 'pending', response: null }] };
      return { rows: [] };
    }, release() {},
  };
  const store = new PostgresOutboundIdempotencyStore({ connect: async () => client } as never);
  await assert.rejects(store.claim(request), error => error === original);
});
