import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli } from '../src/cli.js';

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
    return new Response('{}', { status: 200 });
  };
  for (const args of [['unread', '--account', 'a', '--limit', '5'], ['recent', '--limit', '9'], ['summary', '--since', '2026-01-01'], ['search', 'hello world', '--account', 'a']]) {
    await runCli(args, { AOI_API_URL: 'http://localhost:8080' }, fetcher, () => {});
  }
  assert.deepEqual(calls, [
    'http://localhost:8080/api/messages?account_id=a&limit=5',
    'http://localhost:8080/api/messages?limit=9',
    'http://localhost:8080/api/summary?since=2026-01-01',
    'http://localhost:8080/api/messages?account_id=a&limit=200',
  ]);
});

test('CLI fails clearly without API target and on HTTP errors', async () => {
  await assert.rejects(runCli(['accounts'], {}, fetch, () => {}), /AOI_API_URL/);
  await assert.rejects(runCli(['summary'], { AOI_API_URL: 'http://localhost' }, async () => new Response('{"error":"no"}', { status: 401 }), () => {}), /401/);
});