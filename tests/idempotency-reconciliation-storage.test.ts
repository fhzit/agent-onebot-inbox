import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresIdempotencyReconciliationStorage } from '../src/idempotency-reconciliation-storage.js';

function fakePool(options: { records?: Map<string, string>; insertError?: Error } = {}) {
  const records = options.records ?? new Map([['acct:pending', 'pending']]);
  const events: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const counters = { releases: 0, ledgerUpdates: 0 };
  const client = {
    async query(text: string, values: unknown[] = []) {
      calls.push(text);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
      if (text.includes('UPDATE outbound_idempotency')) counters.ledgerUpdates++;
      if (text.includes('SELECT account_id FROM outbound_idempotency')) return { rows: records.get(`${values[0]}:${values[1]}`) === 'pending' ? [{ account_id: values[0] }] : [] };
      if (text.includes('INSERT INTO outbound_idempotency_adjudications')) {
        if (options.insertError) throw options.insertError;
        const row = { id: String(events.length + 1), account_id: values[0], client_request_id: values[1], outcome: values[2], note: values[3], actor: values[4], created_at: new Date(0) };
        events.push(row); return { rows: [row] };
      }
      throw new Error(`Unexpected client query: ${text}`);
    }, release() { counters.releases++; },
  };
  const pool = {
    connect: async () => client,
    async query(text: string, values: unknown[] = []) {
      calls.push(text);
      if (text.includes('FROM outbound_idempotency_adjudications')) return { rows: events.filter(e => e.account_id === values[0] && e.client_request_id === values[1]) };
      if (text.includes('FROM outbound_idempotency')) return { rows: [{ account_id: values[0], client_request_id: 'pending', message_type: 'private', target_id: 'user', state: 'pending', created_at: new Date(0), updated_at: new Date(0) }] };
      throw new Error(`Unexpected pool query: ${text}`);
    },
  };
  return { pool: pool as never, events, calls, records, get releases() { return counters.releases; }, get ledgerUpdates() { return counters.ledgerUpdates; } };
}

test('pending inspection is account-scoped, bounded and omits payload', async () => {
  const { pool, calls } = fakePool(); const store = new PostgresIdempotencyReconciliationStorage(pool);
  const rows = await store.listPending('acct', 10);
  assert.equal(rows.length, 1);
  assert.equal('payload' in rows[0]!, false);
  assert.deepEqual(calls[0] && ['acct', 10], ['acct', 10]);
  assert.match(calls[0]!, /account_id=\$1/);
});

test('adjudication appends events and never updates ledger or sends', async () => {
  const { pool, events, calls } = fakePool(); const store = new PostgresIdempotencyReconciliationStorage(pool);
  const input = { accountId: 'acct', requestId: 'pending', outcome: 'not-sent' as const, note: 'operator checked', actor: 'operator-1' };
  assert.equal((await store.adjudicate(input)).outcome, 'not-sent');
  assert.equal((await store.adjudicate({ ...input, outcome: 'unresolved' })).outcome, 'unresolved');
  assert.equal(events.length, 2);
  assert.equal((await store.listAdjudications('acct', 'pending')).length, 2);
  assert.equal(calls.some(sql => /UPDATE outbound_idempotency|send/i.test(sql)), false);
});

test('adjudication requires exact account/request and pending record', async () => {
  const { pool, events, releases, ledgerUpdates } = fakePool({ records: new Map([['acct:pending', 'pending'], ['acct:sent-record', 'sent'], ['acct:complete-record', 'complete']]) }); const store = new PostgresIdempotencyReconciliationStorage(pool);
  await assert.rejects(store.adjudicate({ accountId: '', requestId: 'pending', outcome: 'sent', note: '', actor: 'op' }), /accountId/);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: '', outcome: 'sent', note: '', actor: 'op' }), /requestId/);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: 'missing', outcome: 'sent', note: '', actor: 'op' }), /not found/);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: 'sent-record', outcome: 'sent', note: '', actor: 'op' }), /not found/);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: 'complete-record', outcome: 'sent', note: '', actor: 'op' }), /not found/);
  assert.equal(events.length, 0);
  assert.equal(releases, 0);
  assert.equal(ledgerUpdates, 0);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: 'pending', outcome: 'invalid' as never, note: '', actor: 'op' }), /outcome/);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: 'pending', outcome: 'sent', note: 'x'.repeat(1001), actor: 'op' }), /note/);
});

test('insert failure rolls back and releases the client exactly once without changing ledger state', async () => {
  const failure = new Error('database insert failed');
  const { pool, events, calls, releases, ledgerUpdates } = fakePool({ insertError: failure });
  const store = new PostgresIdempotencyReconciliationStorage(pool);
  await assert.rejects(store.adjudicate({ accountId: 'acct', requestId: 'pending', outcome: 'sent', note: '', actor: 'op' }), error => error === failure);
  assert.deepEqual(calls.map(sql => sql === 'BEGIN' || sql === 'ROLLBACK' ? sql : sql.includes('SELECT account_id FROM outbound_idempotency') ? 'SELECT' : sql.includes('INSERT INTO outbound_idempotency_adjudications') ? 'INSERT' : sql), ['BEGIN', 'SELECT', 'INSERT', 'ROLLBACK']);
  assert.equal(releases, 0);
  assert.equal(events.length, 0);
  assert.equal(ledgerUpdates, 0);
});

test('concurrent adjudications can append separate audit outcomes for one pending record', async () => {
  const { pool, events, calls, ledgerUpdates } = fakePool();
  const store = new PostgresIdempotencyReconciliationStorage(pool);
  const [first, second] = await Promise.all([
    store.adjudicate({ accountId: 'acct', requestId: 'pending', outcome: 'sent', note: 'first', actor: 'op-1' }),
    store.adjudicate({ accountId: 'acct', requestId: 'pending', outcome: 'not-sent', note: 'second', actor: 'op-2' }),
  ]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ['not-sent', 'sent']);
  assert.equal(events.length, 2);
  assert.equal(calls.filter(sql => sql === 'BEGIN').length, 2);
  assert.equal(calls.filter(sql => sql === 'COMMIT').length, 2);
  assert.equal(ledgerUpdates, 0);
});

test('pending list limit is validated', async () => {
  const { pool } = fakePool(); const store = new PostgresIdempotencyReconciliationStorage(pool);
  await assert.rejects(store.listPending('acct', 0), /limit/);
  await assert.rejects(store.listPending('acct', 101), /limit/);
});
