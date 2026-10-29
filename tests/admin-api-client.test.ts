import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminApiClient, AdminApiError } from '../src/admin-api-client.js';

test('admin client preserves configured base path and encodes query values with bearer auth', async () => {
  let captured: { url: URL; init?: RequestInit } | undefined;
  const client = new AdminApiClient({ baseUrl: 'https://example.test/console/', token: 'secret', fetcher: async (input, init) => {
    captured = { url: new URL(String(input)), init };
    return new Response('{"ok":true}', { status: 200 });
  }});
  assert.deepEqual(await client.get<{ ok: boolean }>('/api/admin/audit', { query: 'a b', limit: 10, omit: undefined }), { ok: true });
  assert.equal(captured?.url.pathname, '/console/api/admin/audit');
  assert.equal(captured?.url.search, '?query=a+b&limit=10');
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, 'Bearer secret');
});

test('admin client posts JSON and surfaces structured API errors', async () => {
  let captured: RequestInit | undefined;
  const client = new AdminApiClient({ baseUrl: 'https://example.test', fetcher: async (_input, init) => {
    captured = init;
    return new Response('{"error":{"code":"DENIED","message":"Not allowed"}}', { status: 403 });
  }});
  await assert.rejects(client.post('/api/admin/task', { id: 'x' }), (error: unknown) => error instanceof AdminApiError && error.status === 403 && error.code === 'DENIED' && error.message === 'Not allowed');
  assert.equal(captured?.method, 'POST');
  assert.equal(captured?.body, '{"id":"x"}');
});

test('admin client rejects malformed response JSON without leaking response content', async () => {
  const client = new AdminApiClient({ baseUrl: 'https://example.test', fetcher: async () => new Response('secret garbage', { status: 200 }) });
  await assert.rejects(client.get('/api/admin/audit'), (error: unknown) => error instanceof AdminApiError && error.status === 200 && !error.message.includes('secret'));
});
