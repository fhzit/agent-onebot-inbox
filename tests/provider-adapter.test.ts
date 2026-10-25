import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOneBotFileRetriever } from '../src/attachments/provider-adapter.js';
import type { AccountConfig } from '../src/config.js';

const account = { id: 'acct' } as AccountConfig;

test('calls get_file using only provider file ID and returns its local path', async () => {
  const calls: unknown[][] = [];
  const retrieve = createOneBotFileRetriever({ callApi: async (...args: unknown[]) => {
    calls.push(args);
    return { status: 'ok', retcode: 0, data: { file: '/provider/cache/a.bin', url: 'https://example.invalid/a' } };
  } } as never, account);
  assert.equal(await retrieve('provider-id'), '/provider/cache/a.bin');
  assert.deepEqual(calls, [[account, 'get_file', { file_id: 'provider-id' }]]);
});

test('rejects empty identifiers without calling provider', async () => {
  let called = false;
  const retrieve = createOneBotFileRetriever({ callApi: async () => { called = true; return {}; } } as never, account);
  await assert.rejects(retrieve('  '), /file ID is required/);
  assert.equal(called, false);
});

test('rejects unsuccessful or malformed get_file responses', async () => {
  for (const response of [
    { status: 'failed', retcode: 1, data: { file: '/tmp/a' } },
    { status: 'ok', retcode: 0, data: { url: 'https://example.invalid/a' } },
    { status: 'ok', retcode: 0, data: { file: 'relative/path' } },
    { status: 'ok', retcode: 0, data: { file: '' } },
  ]) {
    const retrieve = createOneBotFileRetriever({ callApi: async () => response } as never, account);
    await assert.rejects(retrieve('id'));
  }
});
