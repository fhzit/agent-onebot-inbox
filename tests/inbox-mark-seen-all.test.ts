import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../src/store.js';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import { normalizeEvent } from '../src/normalize.js';
import { startServer } from '../src/server.js';

const event = (userId: string) => normalizeEvent('main', 'napcat', 'ws', {
  post_type: 'message', message_type: 'private', self_id: '1', user_id: userId,
  message_id: Number(userId), time: 1700000000, message: 'hello',
})!;

test('MessageStore markAllSeen changes seen state only for incoming messages', async () => {
  const store = new MessageStore();
  const incoming = store.insert(event('2'));
  store.insert(event('3'));
  await store.markProcessed(incoming.message.id);
  assert.equal(store.markAllSeen(), 1);
  for (const row of store.query({ account_id: 'main', limit: 10 }).messages) {
    const state = store.state(row.id)!;
    assert.equal(state.seen_by_agent, true);
    assert.equal(state.processed, row.id === incoming.message.id);
    assert.equal(state.qq_read, false);
  }
});

test('PostgresMessageStore markAllSeen uses one bulk update limited to unseen incoming rows', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client: SqlClient = { async query(text, values) { calls.push({ text, values }); return { rows: [{ count: '3' }] }; } };
  assert.equal(await new PostgresMessageStore(client).markAllSeen(), 3);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /INSERT INTO inbox_states/i);
  assert.match(calls[0]!.text, /seen_by_agent\s*=\s*true/i);
  assert.match(calls[0]!.text, /direction\s*=\s*'incoming'/i);
  assert.match(calls[0]!.text, /COALESCE\(s\.seen_by_agent,false\)=false/i);
  assert.doesNotMatch(calls[0]!.text, /SET[^;]*processed\s*=/i);
  assert.doesNotMatch(calls[0]!.text, /SET[^;]*qq_read\s*=/i);
  assert.deepEqual(calls[0]!.values ?? [], []);
});

test('mark-all-seen API requires auth and preserves processed and QQ read state', async () => {
  const port = 32000 + Math.floor(Math.random() * 500);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const auth = { authorization: 'Bearer api-secret' };
    for (const id of [91, 92]) await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' }, body: JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: id, time: 1700000000, message: `hello ${id}` }) });
    const initial = await (await fetch(`http://127.0.0.1:${port}/api/messages`, { headers: auth })).json() as { messages: { id: string; state: { unread: boolean; processed: boolean; seen_by_agent: boolean; qq_read: boolean } }[] };
    await fetch(`http://127.0.0.1:${port}/api/messages/mark_processed`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ message_id: initial.messages[0]!.id }) });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/messages/mark_seen_all`, { method: 'POST' })).status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/api/messages/mark_seen_all`, { method: 'POST', headers: auth });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { updated: number }).updated, 1);
    const after = await (await fetch(`http://127.0.0.1:${port}/api/messages`, { headers: auth })).json() as typeof initial;
    assert.equal(after.messages.length, 2);
    for (const row of after.messages) {
      assert.equal(row.state.seen_by_agent, true);
      assert.equal(row.state.unread, false);
      assert.equal(row.state.qq_read, false);
    }
    assert.equal(after.messages.filter(row => row.state.processed).length, 1);
  } finally { await runtime.close(); }
});
