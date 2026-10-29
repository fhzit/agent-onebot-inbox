import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli } from '../src/cli.js';

test('CLI exposes the unauthenticated runtime health check', async () => {
  const calls: string[] = [];
  const output: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${String(input)} ${init?.method}`);
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };
  await runCli(['health'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, text => output.push(text));
  assert.deepEqual(calls, ['http://localhost:8080/health GET']);
  assert.deepEqual(JSON.parse(output[0]!), { status: 'ok' });
});


test('CLI fetches read-only API endpoints with bearer token and prints parsed JSON', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const output: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ accounts: [{ id: 'a' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await runCli(['accounts'], { AOI_API_URL: 'http://localhost:8080', AOI_API_TOKEN: 'secret' }, fetcher, text => output.push(text));
  assert.deepEqual(calls, [{ url: 'http://localhost:8080/api/accounts', authorization: 'Bearer secret' }]);
  assert.deepEqual(JSON.parse(output[0]!), { accounts: [{ id: 'a' }] });
});

test('CLI supports list, summary and search using the existing API routes', async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    const url = new URL(String(input));
    if (url.pathname === '/api/messages' && url.searchParams.has('offset')) return new Response(JSON.stringify({ messages: [], total: 0, offset: 0, limit: 200, has_more: false }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  for (const args of [['unread', '--account', 'a', '--limit', '5'], ['recent', '--limit', '9'], ['summary', '--since', '2026-01-01'], ['search', 'hello world', '--account', 'a']]) {
    await runCli(args, { AOI_API_URL: 'http://localhost:8080' }, fetcher, () => {});
  }
  assert.deepEqual(calls, [
    'http://localhost:8080/api/messages?account_id=a&unread=true&limit=5',
    'http://localhost:8080/api/messages?limit=9',
    'http://localhost:8080/api/summary?since=2026-01-01',
    'http://localhost:8080/api/messages?account_id=a&keyword=hello+world&limit=200&offset=0',
  ]);
});

test('CLI reports provider capability declarations without exposing API credentials', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const output: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ verification: 'declarations_only', capabilities: [{ provider: 'napcat', declared: true, verified: false, actions: ['get_file'] }] }), { status: 200 });
  };
  await runCli(['provider-capabilities'], { AOI_API_URL: 'http://localhost:8080', AOI_API_TOKEN: 'private-token' }, fetcher, text => output.push(text));
  assert.deepEqual(calls, [{ url: 'http://localhost:8080/api/admin/provider-capabilities', authorization: 'Bearer private-token' }]);
  assert.match(output[0]!, /declarations_only/);
  assert.doesNotMatch(output[0]!, /private-token/);
});

test('CLI exposes processed and dismissed inbox state filters through the existing API', async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  };
  await runCli(['processed', '--account', 'a'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, () => {});
  await runCli(['dismissed'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, () => {});
  assert.deepEqual(calls, [
    'http://localhost:8080/api/messages?account_id=a&processed=true&limit=50',
    'http://localhost:8080/api/messages?dismissed=true&limit=50',
  ]);
});

test('CLI fails clearly without API target and on HTTP errors', async () => {
  await assert.rejects(runCli(['accounts'], {}, fetch, () => {}), /AOI_API_URL/);
  await assert.rejects(runCli(['summary'], { AOI_API_URL: 'http://localhost' }, async () => new Response('{"error":"no"}', { status: 401 }), () => {}), /401/);
});

test('search accepts an explicit page limit', async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ messages: [{ id: '1' }], total: 1, offset: 0, limit: 7, has_more: false }), { status: 200 });
  };
  await runCli(['search', 'hello', '--limit', '7'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, () => {});
  assert.deepEqual(calls, ['http://localhost:8080/api/messages?keyword=hello&limit=7&offset=0']);
});

test('search uses PostgreSQL-backed keyword matching and returns the API result', async () => {
  const calls: string[] = [];
  const output: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ messages: [{ id: '2', plain_text: 'hello there' }], total: 1, offset: 0, limit: 200, has_more: false }), { status: 200 });
  };
  await runCli(['search', 'hello there'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, text => output.push(text));
  assert.deepEqual(calls, ['http://localhost:8080/api/messages?keyword=hello+there&limit=200&offset=0']);
  assert.deepEqual(JSON.parse(output[0]!), { messages: [{ id: '2', plain_text: 'hello there' }], total: 1, offset: 0, limit: 200, has_more: false });
});

test('search falls back to paginated substring matching when keyword query is unsupported', async () => {
  const calls: string[] = [];
  const output: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input)); calls.push(url.href);
    if (url.searchParams.has('keyword')) return new Response('unsupported keyword', { status: 400 });
    const offset = Number(url.searchParams.get('offset'));
    const page = offset === 0
      ? { messages: Array.from({ length: 200 }, (_, i) => ({ id: `first-${i}`, plain_text: i === 199 ? 'unrelated last' : 'unrelated' })), total: 202, offset: 0, limit: 200, has_more: true }
      : { messages: [{ id: '2', plain_text: 'HELLO later' }, { id: '3', plain_text: 'hello last' }], total: 202, offset: 200, limit: 200, has_more: false };
    return new Response(JSON.stringify(page), { status: 200 });
  };
  await runCli(['search', 'hello'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, text => output.push(text));
  assert.deepEqual(calls, [
    'http://localhost:8080/api/messages?keyword=hello&limit=200&offset=0',
    'http://localhost:8080/api/messages?limit=200&offset=0',
    'http://localhost:8080/api/messages?limit=200&offset=200',
  ]);
  assert.deepEqual(JSON.parse(output[0]!), { messages: [{ id: '2', plain_text: 'HELLO later' }, { id: '3', plain_text: 'hello last' }] });
});

test('search paginates through every API page before filtering query matches', async () => {
  const calls: string[] = [];
  const output: string[] = [];
  const pages = [
    { messages: Array.from({ length: 200 }, (_, i) => ({ id: `first-${i}`, plain_text: i === 199 ? 'unrelated last' : 'unrelated' })), total: 202, offset: 0, limit: 200, has_more: true },
    { messages: [{ id: '2', plain_text: 'HELLO later' }, { id: '3', plain_text: 'hello last' }], total: 202, offset: 200, limit: 200, has_more: false },
  ];
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    const parsed = new URL(String(input));
    if (parsed.searchParams.has('keyword')) return new Response('unsupported keyword', { status: 400 });
    const offset = Number(parsed.searchParams.get('offset'));
    return new Response(JSON.stringify(pages[offset === 0 ? 0 : 1]), { status: 200 });
  };
  await runCli(['search', 'hello'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, text => output.push(text));
  assert.deepEqual(calls, [
    'http://localhost:8080/api/messages?keyword=hello&limit=200&offset=0',
    'http://localhost:8080/api/messages?limit=200&offset=0',
    'http://localhost:8080/api/messages?limit=200&offset=200',
  ]);
  assert.deepEqual(JSON.parse(output[0]!), { messages: [{ id: '2', plain_text: 'HELLO later' }, { id: '3', plain_text: 'hello last' }] });
});

test('search rejects a terminal page that ends before the reported total', async () => {
  await assert.rejects(runCli(['search', 'hello'], { AOI_API_URL: 'http://localhost:8080' }, async () => new Response(JSON.stringify({ messages: [{ plain_text: 'hello' }], total: 3, offset: 0, limit: 200, has_more: false }), { status: 200 }), () => {}), /pagination metadata/);
});

test('search enforces a maximum accumulated message count', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify({ messages: Array.from({ length: 200 }, () => ({ plain_text: 'hello' })), total: 1000000, offset: (calls - 1) * 200, limit: 200, has_more: true }), { status: 200 });
  };
  await assert.rejects(runCli(['search', 'hello'], { AOI_API_URL: 'http://localhost:8080' }, fetcher, () => {}), /maximum.*messages/i);
  assert.equal(calls, 1);
});

test('search fails rather than claiming completeness when pagination metadata is missing', async () => {
  await assert.rejects(runCli(['search', 'hello'], { AOI_API_URL: 'http://localhost:8080' }, async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }), () => {}), /pagination metadata/);
});