import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderHistoryPage, MAX_PROVIDER_HISTORY_COUNT } from '../src/provider-history.js';
import type { AccountConfig } from '../src/config.js';

const account = (provider: string) => ({ provider } as AccountConfig);
const ok = (messages: unknown[]) => ({ status: 'ok', retcode: 0, data: { messages } });

test('NapCat history pages use documented action, target key, and bounded count', async () => {
  const calls: unknown[][] = [];
  const messages = Array.from({ length: 4 }, (_, i) => ({ message_id: i }));
  const page = await fetchProviderHistoryPage({ callApi: async (...args) => {
    calls.push(args.slice(0, 3));
    return ok(messages);
  } }, account('napcat'), 'private', '123', MAX_PROVIDER_HISTORY_COUNT + 1);
  assert.deepEqual(calls, [[account('napcat'), 'get_friend_msg_history', { user_id: '123', count: MAX_PROVIDER_HISTORY_COUNT }]]);
  assert.deepEqual(page.messages, messages);
});

test('NapCat group history calls group action with requested page count', async () => {
  const calls: unknown[][] = [];
  await fetchProviderHistoryPage({ callApi: async (...args) => { calls.push(args.slice(0, 3)); return ok([]); } }, account('napcat'), 'group', 42, 10);
  assert.deepEqual(calls[0]?.slice(1), ['get_group_msg_history', { group_id: 42, count: 10 }]);
});

test('confirmed SnowLuma actions receive only documented parameters and normalize messages', async () => {
  const calls: unknown[][] = [];
  const expected = [{ message_id: 8 }];
  const page = await fetchProviderHistoryPage({ callApi: async (...args) => { calls.push(args.slice(0, 3)); return ok([...expected, { message_id: 9 }]); } }, account('snowluma'), 'group', 7, 1);
  assert.deepEqual(calls[0]?.slice(1), ['get_group_msg_history', { group_id: 7, count: 1 }]);
  assert.deepEqual(page, { messages: expected });
});

test('unknown provider, invalid inputs, failed envelopes, and malformed data fail closed', async () => {
  let called = false;
  const api = { callApi: async () => { called = true; return ok([]); } };
  await assert.rejects(fetchProviderHistoryPage(api, account('future'), 'private', 1, 1), /unsupported/);
  for (const [target, count] of [[' ', 1], [1, 0], [1, 1.2], [Number.MAX_SAFE_INTEGER + 1, 1]] as const) {
    await assert.rejects(fetchProviderHistoryPage(api, account('napcat'), 'private', target, count));
  }
  assert.equal(called, false);
  for (const response of [{ status: 'failed', retcode: 1, data: { messages: [] } }, { status: 'ok', retcode: 0, data: {} }, null]) {
    await assert.rejects(fetchProviderHistoryPage({ callApi: async () => response }, account('napcat'), 'private', 1, 1));
  }
});

test('invalid history kind and timeout are rejected before provider call', async () => {
  let called = false;
  const api = { callApi: async () => { called = true; return ok([]); } };
  await assert.rejects(fetchProviderHistoryPage(api, account('napcat'), 'sideways' as never, 1, 1));
  await assert.rejects(fetchProviderHistoryPage(api, account('napcat'), 'private', 1, 1, { timeoutMs: 0 }));
  assert.equal(called, false);
});

test('caller cancellation aborts provider call and rejects promptly', async () => {
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  const pending = fetchProviderHistoryPage({ callApi: async (_a, _action, _params, options) => {
    signal = options?.signal;
    return new Promise(() => {});
  } }, account('napcat'), 'private', 1, 1, { signal: controller.signal, timeoutMs: 5_000 });
  controller.abort(new Error('caller stopped'));
  await assert.rejects(pending, /caller stopped/);
  assert.equal(signal?.aborted, true);
});

test('provider history timeout aborts the provider signal', async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(fetchProviderHistoryPage({ callApi: async (_a, _action, _params, options) => {
    signal = options?.signal;
    return new Promise(() => {});
  } }, account('napcat'), 'private', 1, 1, { timeoutMs: 5 }), /timed out/);
  assert.equal(signal?.aborted, true);
});
