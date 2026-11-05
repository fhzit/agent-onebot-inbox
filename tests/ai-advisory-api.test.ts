import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { AiAdvisoryRecord } from '../src/ai-advisory-store.js';
import { registerAiAdvisoryApi } from '../src/ai-advisory-api.js';

const row: AiAdvisoryRecord = { accountId: 'acct-a', messageId: 'm1', label: 'urgent', confidence: 0.9, model: 'model-x', policyVersion: 'p1', createdAt: '2025-01-01T00:00:00.000Z' };
function setup(overrides: { authenticated?: boolean; authorized?: boolean; list?: (accountId: string, options: { before?: string; beforeMessageId?: string; limit: number }) => Promise<AiAdvisoryRecord[]> } = {}) {
  const calls: unknown[][] = [];
  const app = Fastify();
  registerAiAdvisoryApi(app, {
    isAuthenticated: async () => overrides.authenticated ?? true,
    isAuthorizedForAccount: async (_request, accountId) => { calls.push(['authorize', accountId]); return overrides.authorized ?? true; },
    store: { list: async (accountId, options) => { calls.push(['list', accountId, options]); return overrides.list ? overrides.list(accountId, options) : [row]; } },
  });
  return { app, calls };
}

test('requires authentication before account authorization or store access', async () => {
  const { app, calls } = setup({ authenticated: false });
  const response = await app.inject('/api/accounts/acct-a/ai-advisories');
  assert.equal(response.statusCode, 401);
  assert.deepEqual(calls, []);
  await app.close();
});

test('checks account authorization before store access', async () => {
  const { app, calls } = setup({ authorized: false });
  const response = await app.inject('/api/accounts/acct-b/ai-advisories');
  assert.equal(response.statusCode, 403);
  assert.deepEqual(calls, [['authorize', 'acct-b']]);
  await app.close();
});

test('bounds page size and returns safe fields plus a next cursor', async () => {
  const { app, calls } = setup({ list: async (_accountId, _options) => [row, { ...row, messageId: 'm2' }] });
  const response = await app.inject('/api/accounts/acct-a/ai-advisories?limit=2');
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.advisories[0], { messageId: 'm1', label: 'urgent', confidence: 0.9, model: 'model-x', policyVersion: 'p1', createdAt: row.createdAt });
  assert.equal('accountId' in body.advisories[0], false);
  assert.deepEqual(body.nextCursor, { before: row.createdAt, before_message_id: 'm2' });
  assert.deepEqual(calls[1], ['list', 'acct-a', { limit: 2 }]);
  await app.close();
});

test('validates pagination and passes normalized cursor', async () => {
  const { app, calls } = setup();
  assert.equal((await app.inject('/api/accounts/a/ai-advisories?limit=1000')).statusCode, 400);
  assert.equal((await app.inject('/api/accounts/a/ai-advisories?before=not-a-date&before_message_id=m1')).statusCode, 400);
  assert.equal((await app.inject('/api/accounts/a/ai-advisories?before=2025-01-01T00%3A00%3A00Z')).statusCode, 400);
  assert.equal(calls.length, 3);
  const response = await app.inject('/api/accounts/a/ai-advisories?limit=3&before=2025-01-01T00%3A00%3A00Z&before_message_id=m1');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[4], ['list', 'a', { limit: 3, before: row.createdAt, beforeMessageId: 'm1' }]);
  await app.close();
});

test('composite cursor preserves equal-timestamp pagination boundary', async () => {
  const sameTime = { ...row, createdAt: row.createdAt };
  const { app, calls } = setup({ list: async (_accountId, options) => options.beforeMessageId ? [{ ...sameTime, messageId: 'm1' }] : [{ ...sameTime, messageId: 'm2' }, { ...sameTime, messageId: 'm1' }] });
  const first = await app.inject('/api/accounts/a/ai-advisories?limit=1');
  assert.deepEqual(first.json().nextCursor, { before: row.createdAt, before_message_id: 'm2' });
  const cursor = first.json().nextCursor;
  const second = await app.inject(`/api/accounts/a/ai-advisories?limit=1&before=${encodeURIComponent(cursor.before)}&before_message_id=${cursor.before_message_id}`);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().advisories[0].messageId, 'm1');
  assert.deepEqual(calls[3], ['list', 'a', { limit: 1, before: row.createdAt, beforeMessageId: 'm2' }]);
  await app.close();
});

test('maps store failures to a generic service error', async () => {
  const { app } = setup({ list: async () => { throw new Error('private database detail'); } });
  const response = await app.inject('/api/accounts/a/ai-advisories');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'AI advisories unavailable' });
  await app.close();
});
