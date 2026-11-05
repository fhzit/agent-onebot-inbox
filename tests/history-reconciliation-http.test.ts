import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createHistoryReconciliationHttpHandler } from '../src/history-reconciliation-http.js';

const account = { id: 'acct-1' } as never;
async function request(handler: ReturnType<typeof createHistoryReconciliationHttpHandler>, body: string, options: { authorized?: boolean; path?: string } = {}) {
  const server = createServer((req, res) => { void handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${options.path ?? '/api/admin/accounts/acct-1/history/reconcile/preview'}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
      ...(options.authorized === undefined ? {} : { headers: { 'content-type': 'application/json', authorization: options.authorized ? 'Bearer valid' : 'Bearer invalid' } }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally { server.close(); await once(server, 'close'); }
}

test('raw HTTP handler authenticates, bounds JSON, resolves account and returns read-only preview', async () => {
  let calls = 0;
  const handler = createHistoryReconciliationHttpHandler({
    isAuthorized: req => req.headers.authorization === 'Bearer valid',
    resolveAccount: async id => id === 'acct-1' ? account : undefined,
    maxBodyBytes: 128,
    service: async input => { calls++; assert.equal(input.accountId, 'acct-1'); return { plan: { missing: [], existing: [], duplicates: [], truncated: false } } as never; },
  });
  assert.equal((await request(handler, '{"kind":"private","targetId":"2","limit":2}', { authorized: false })).status, 401);
  assert.equal(calls, 0);
  const result = await request(handler, '{"kind":"private","targetId":"2","limit":2}', { authorized: true });
  assert.equal(result.status, 200); assert.equal(calls, 1);
  assert.deepEqual(result.body, { plan: { missing: [], existing: [], duplicates: [], truncated: false } });
});

test('raw HTTP handler rejects invalid, oversized and unresolved requests without invoking service', async () => {
  let calls = 0;
  const handler = createHistoryReconciliationHttpHandler({ isAuthorized: () => true, resolveAccount: async () => undefined, maxBodyBytes: 64, service: async () => { calls++; return {} as never; } });
  assert.equal((await request(handler, '{')).status, 400);
  assert.equal((await request(handler, JSON.stringify({ kind: 'private', targetId: '2', limit: 1, extra: 'x'.repeat(100) }))).status, 413);
  assert.equal((await request(handler, '{"kind":"private","targetId":"2","limit":1}')).status, 404);
  assert.equal((await request(handler, '{}', { path: '/elsewhere' })).status, 404);
  assert.equal(calls, 0);
});

test('raw HTTP handler enforces limit lower and upper validation before service boundary', async () => {
  const invoked: number[] = [];
  const handler = createHistoryReconciliationHttpHandler({
    isAuthorized: () => true, resolveAccount: () => account,
    service: async input => { invoked.push(input.count); return { plan: { missing: [], existing: [], duplicates: [], truncated: false } }; },
  });
  const body = (limit: number) => JSON.stringify({ kind: 'private', targetId: '2', limit });
  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request(handler, body(limit))).status, 400, `limit ${limit}`);
  }
  assert.equal((await request(handler, body(1))).status, 200);
  assert.equal((await request(handler, body(Number.MAX_SAFE_INTEGER))).status, 200);
  assert.deepEqual(invoked, [1, Number.MAX_SAFE_INTEGER]);
});

test('raw HTTP handler confines work to injected read-only preview boundary', async () => {
  const calls: string[] = [];
  const handler = createHistoryReconciliationHttpHandler({
    isAuthorized: () => true,
    resolveAccount: id => { calls.push(`resolve:${id}`); return account; },
    service: async input => {
      calls.push(`preview:${input.accountId}:${input.kind}:${input.targetId}:${input.count}`);
      return { plan: { missing: [], existing: [], duplicates: [], truncated: false } };
    },
  });
  const result = await request(handler, '{"kind":"private","targetId":"2","limit":7}');
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['resolve:acct-1', 'preview:acct-1:private:2:7']);
});

test('raw HTTP handler sanitizes internal service errors', async () => {
  const secret = 'database password and /private/path';
  const handler = createHistoryReconciliationHttpHandler({
    isAuthorized: () => true, resolveAccount: () => account,
    service: async () => { throw new Error(secret); },
  });
  const result = await request(handler, '{"kind":"private","targetId":"2","limit":7}');
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { error: 'History reconciliation failed' });
  assert.equal(JSON.stringify(result.body).includes(secret), false);
});
