import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerHistoryReconciliationRoute } from '../src/history-reconciliation-route.js';
import type { AccountConfig } from '../src/config.js';
import type { NormalizedMessage } from '../src/normalize.js';

const account = { id: 'acct', provider: 'napcat' } as AccountConfig;
const msg = { id: 'm1', account_id: 'acct', conversation_id: 'target', external_message_id: 'm1', event_fingerprint: 'fp' } as NormalizedMessage;

test('route authenticates, resolves account, bounds request and returns dry-run plan', async () => {
  const app = Fastify();
  const events: string[] = [];
  let requestedCount = 0;
  registerHistoryReconciliationRoute(app, {
    preHandler: async () => { events.push('auth'); },
    resolveAccount: async id => { events.push(`resolve:${id}`); return account; },
    fetchHistory: async (_request, count) => { requestedCount = count; events.push('provider'); return [msg]; },
    store: { list: async () => { events.push('list'); return []; } },
    audit: { record: async entry => { events.push('audit'); assert.equal(entry.result, 'success'); } },
    maxMessages: 10,
  });
  const response = await app.inject({ method: 'POST', url: '/api/admin/accounts/acct/history/reconcile/preview', payload: { kind: 'group', targetId: 'target', limit: 99 } });
  assert.equal(response.statusCode, 200);
  assert.equal(requestedCount, 10);
  assert.equal(response.json().plan.missing.length, 1);
  assert.deepEqual(events, ['auth', 'resolve:acct', 'provider', 'list', 'audit']);
  await app.close();
});

test('route rejects invalid requests before provider or local reads', async () => {
  const app = Fastify();
  let calls = 0;
  registerHistoryReconciliationRoute(app, {
    preHandler: async () => undefined,
    resolveAccount: async () => { calls++; return account; },
    fetchHistory: async () => { calls++; return []; },
    store: { list: async () => { calls++; return []; } },
    audit: { record: async () => { calls++; } },
  });
  const response = await app.inject({ method: 'POST', url: '/api/admin/accounts/acct/history/reconcile/preview', payload: { kind: 'import', targetId: 'x', limit: 1 } });
  assert.equal(response.statusCode, 400);
  assert.equal(calls, 0);
  await app.close();
});

test('route returns not-found for unresolved accounts', async () => {
  const app = Fastify();
  registerHistoryReconciliationRoute(app, {
    preHandler: async () => undefined,
    resolveAccount: async () => undefined,
    fetchHistory: async () => [], store: { list: async () => [] }, audit: { record: async () => undefined },
  });
  const response = await app.inject({ method: 'POST', url: '/api/admin/accounts/missing/history/reconcile/preview', payload: { kind: 'private', targetId: 'u', limit: 1 } });
  assert.equal(response.statusCode, 404);
  await app.close();
});
