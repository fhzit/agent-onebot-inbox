import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import type { PostgresIdempotencyReconciliationStorage } from '../src/idempotency-reconciliation-storage.js';

type Adapter = Pick<PostgresIdempotencyReconciliationStorage, 'listPending' | 'adjudicate'>;
const account = { id: 'acct-1', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
const record = { accountId: 'acct-1', requestId: 'request-1', messageType: 'private' as const, targetId: '42', state: 'pending' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' };
async function withServer(adapter?: Adapter, configure?: (a: Adapter) => void) {
  const runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] }, undefined, undefined, { idempotencyReconciliation: adapter });
  const address = runtime.address()!;
  return { runtime, url: `http://127.0.0.1:${address.port}/api/admin/idempotency/reconciliation`, configure };
}
const auth = { authorization: 'Bearer api-secret' };

test('reconciliation route authenticates, lists redacted pending records, and never sends', async () => {
  const calls: string[] = [];
  const adapter: Adapter = { async listPending(id, limit) { calls.push(`list:${id}:${limit}`); return [record, { ...record, payload: 'must not leak', response: 'secret response' } as never]; }, async adjudicate(input) { calls.push(`adjudicate:${input.requestId}`); return { id: 'adj-1', ...input, createdAt: 'now' }; } };
  const { runtime, url } = await withServer(adapter);
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(`${url}?accountId=acct-1&limit=7`, { headers: auth });
    assert.equal(response.status, 200);
    const body = await response.json() as { records: Record<string, unknown>[]; automaticRetry: boolean };
    assert.deepEqual(body.records, [record, record]);
    assert.equal(body.automaticRetry, false);
    assert.equal('payload' in body.records[0]!, false);
    assert.equal('response' in body.records[0]!, false);
    assert.deepEqual(calls, ['list:acct-1:7']);
  } finally { await runtime.close(); }
});

test('reconciliation route rejects invalid queries, unknown routes, and unsupported methods', async () => {
  const calls: string[] = [];
  const adapter: Adapter = { async listPending(id, limit) { calls.push(`list:${id}:${limit}`); return []; }, async adjudicate(input) { calls.push(`adjudicate:${input.requestId}`); return { id: 'adj-1', ...input }; } };
  const { runtime, url } = await withServer(adapter);
  try {
    for (const query of ['accountId=', 'accountId=bad%2Fid', 'accountId=acct-1&limit=0', 'accountId=acct-1&limit=101', 'accountId=acct-1&limit=1.5']) {
      assert.equal((await fetch(`${url}?${query}`, { headers: auth })).status, 400, query);
    }
    assert.equal((await fetch(`${url}/%ZZ/request-1/adjudicate`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"outcome":"sent","note":"x"}' })).status, 400);
    assert.equal((await fetch(`${url}/unknown`, { headers: auth })).status, 405);
    assert.equal((await fetch(url, { method: 'PUT', headers: auth })).status, 405);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).status, 405);
    assert.deepEqual(calls, []);
  } finally { await runtime.close(); }
});

test('reconciliation POST authenticates and rejects malformed or oversized bodies without adjudicating', async () => {
  const calls: unknown[] = [];
  const adapter: Adapter = { async listPending() { return []; }, async adjudicate(input) { calls.push(input); return { id: 'adj-1', ...input }; } };
  const { runtime, url } = await withServer(adapter);
  try {
    const path = `${url}/acct-1/request-1/adjudicate`;
    assert.equal((await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"outcome":"sent","note":"x"}' })).status, 401);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'sent', note: 'x'.repeat(8193) }) })).status, 400);
    assert.deepEqual(calls, []);
  } finally { await runtime.close(); }
});

test('reconciliation route reports unavailable storage and query failure safely', async () => {
  const noStorage = await withServer();
  try { const response = await fetch(noStorage.url, { headers: auth }); assert.equal(response.status, 503); } finally { await noStorage.runtime.close(); }
  const broken: Adapter = { async listPending() { throw new Error('sensitive database error'); }, async adjudicate() { throw new Error('sensitive database error'); } };
  const failing = await withServer(broken);
  try { const response = await fetch(`${failing.url}?accountId=acct-1`, { headers: auth }); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /sensitive/); } finally { await failing.runtime.close(); }
});

test('adjudication requires explicit valid identifiers and outcome, and never sends', async () => {
  const calls: unknown[] = [];
  const adapter: Adapter = { async listPending() { return []; }, async adjudicate(input) { calls.push(input); return { id: 'adj-1', outcome: input.outcome, accountId: input.accountId, requestId: input.requestId }; } };
  const { runtime, url } = await withServer(adapter);
  try {
    const path = `${url}/acct-1/request-1/adjudicate`;
    assert.equal((await fetch(path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'sent', note: 'confirmed' }) })).status, 200);
    assert.deepEqual(calls, [{ accountId: 'acct-1', requestId: 'request-1', outcome: 'sent', note: 'confirmed', actor: 'admin' }]);
    assert.equal((await fetch(`${url}/bad%2Fid/request-1/adjudicate`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'sent', note: 'confirmed' }) })).status, 400);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'retry', note: 'confirmed' }) })).status, 400);
    assert.equal(calls.length, 1);
  } finally { await runtime.close(); }
});
