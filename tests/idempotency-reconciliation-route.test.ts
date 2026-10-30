import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerIdempotencyReconciliationRoute } from '../src/idempotency-reconciliation-route.js';

const record = { accountId: 'acct', requestId: 'req-1', messageType: 'private' as const, targetId: 'user-7', payload: { text: 'hello' }, state: 'pending' as const, response: null };

test('operator reconciliation is protected and reports pending records without resend', async () => {
  const app = Fastify();
  let listed = 0;
  let adjudicated = 0;
  registerIdempotencyReconciliationRoute(app, {
    preHandler: async (_request, reply) => { if (_request.headers.authorization !== 'Bearer operator') return reply.code(401).send({ error: 'Unauthorized' }); },
    listPending: async () => { listed++; return [record]; },
    adjudicate: async () => { adjudicated++; },
  });
  try {
    const denied = await app.inject({ method: 'GET', url: '/api/admin/idempotency/reconciliation', headers: { authorization: 'Bearer user' } });
    assert.equal(denied.statusCode, 401);
    assert.equal(listed, 0);
    const response = await app.inject({ method: 'GET', url: '/api/admin/idempotency/reconciliation', headers: { authorization: 'Bearer operator' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { records: [record], automaticRetry: false });
    assert.equal(listed, 1);
    assert.equal(adjudicated, 0);
  } finally { await app.close(); }
});

test('adjudication requires an explicit operator action and never calls a resend dependency', async () => {
  const app = Fastify();
  const seen: unknown[] = [];
  registerIdempotencyReconciliationRoute(app, {
    preHandler: async (_request, reply) => { if (_request.headers.authorization !== 'Bearer operator') return reply.code(401).send({ error: 'Unauthorized' }); },
    listPending: async () => [record],
    adjudicate: async input => { seen.push(input); return { status: 'adjudicated' }; },
  });
  try {
    const unauthorized = await app.inject({ method: 'POST', url: '/api/admin/idempotency/reconciliation/req-1/adjudicate', payload: { outcome: 'sent', note: 'verified at provider' } });
    assert.equal(unauthorized.statusCode, 401);
    const response = await app.inject({ method: 'POST', url: '/api/admin/idempotency/reconciliation/req-1/adjudicate', headers: { authorization: 'Bearer operator' }, payload: { outcome: 'sent', note: 'verified at provider' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'adjudicated', automaticRetry: false });
    assert.deepEqual(seen, [{ requestId: 'req-1', outcome: 'sent', note: 'verified at provider' }]);
    const invalid = await app.inject({ method: 'POST', url: '/api/admin/idempotency/reconciliation/req-1/adjudicate', headers: { authorization: 'Bearer operator' }, payload: { outcome: 'retry' } });
    assert.equal(invalid.statusCode, 400);
  } finally { await app.close(); }
});
