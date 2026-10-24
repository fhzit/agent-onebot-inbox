import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresOutboundIdempotencyStore } from '../src/outbound-idempotency-store.js';

function fakePool() {
  const records = new Map<string, Record<string, unknown>>();
  const client = {
    async query(text: string, values: unknown[] = []) {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
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
