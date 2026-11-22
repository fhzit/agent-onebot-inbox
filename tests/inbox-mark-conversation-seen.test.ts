import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../src/store.js';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import { normalizeEvent } from '../src/normalize.js';
import { markConversationReadAfterOutgoing, startServer } from '../src/server.js';

const silentLogger = { info() {}, warn() {} };

const incoming = (userId: string, time: number, messageId: number) => normalizeEvent('main', 'napcat', 'ws', {
  post_type: 'message', message_type: 'private', self_id: '1', user_id: userId,
  message_id: messageId, time, message: `hello ${messageId}`,
})!;

const outgoingEvent = (peerId: string, time: number, messageId: number) => normalizeEvent('main', 'napcat', 'ws', {
  post_type: 'message_sent', message_type: 'private', self_id: '1', user_id: '1',
  target_id: peerId, message_id: messageId, time, message: 'my reply',
})!;

test('MessageStore marks only earlier incoming messages in the same conversation', () => {
  const store = new MessageStore();
  const early = store.insert(incoming('2', 1700000000, 11)).message;
  const late = store.insert(incoming('2', 1700000600, 12)).message;
  const otherPeer = store.insert(incoming('3', 1700000000, 13)).message;
  const reply = outgoingEvent('2', 1700000300, 14);

  const updated = store.markConversationSeen(reply.conversation_id, reply.sent_at);

  assert.equal(updated, 1);
  assert.equal(store.state(early.id)!.seen_by_agent, true);
  assert.equal(store.state(early.id)!.unread, false);
  assert.equal(store.state(late.id)!.unread, true, 'later messages stay unread');
  assert.equal(store.state(otherPeer.id)!.unread, true, 'other conversations stay unread');
  assert.equal(store.state(early.id)!.processed, false, 'seen is not processed');
  assert.equal(store.state(early.id)!.qq_read, false, 'QQ read state is never claimed');
});

test('markConversationReadAfterOutgoing ignores incoming messages', async () => {
  const store = new MessageStore();
  const stored = store.insert(incoming('2', 1700000000, 21)).message;
  assert.equal(await markConversationReadAfterOutgoing(store, stored, silentLogger), 0);
  assert.equal(store.query({ account_id: 'main', state: 'unread', limit: 10 }).total, 1);
});

test('PostgresMessageStore markConversationSeen scopes one update by conversation and timestamp', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client: SqlClient = { async query(text, values) { calls.push({ text, values }); return { rows: [{ count: '2' }] }; } };
  const updated = await new PostgresMessageStore(client).markConversationSeen('main:private:2', '2026-11-22T00:00:00.000Z');

  assert.equal(updated, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /INSERT INTO inbox_states/i);
  assert.match(calls[0]!.text, /m\.conversation_id=\$1/i);
  assert.match(calls[0]!.text, /m\.sent_at <= \$2::timestamptz/i);
  assert.match(calls[0]!.text, /direction\s*=\s*'incoming'/i);
  assert.doesNotMatch(calls[0]!.text, /processed\s*=/i);
  assert.deepEqual(calls[0]!.values, ['main:private:2', '2026-11-22T00:00:00.000Z']);
});

test('an account reply through the transport clears that conversation unread', async () => {
  const port = 33000 + Math.floor(Math.random() * 500);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  const post = (body: Record<string, unknown>) => fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, {
    method: 'POST', headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const id of [101, 102]) {
      await post({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: id, time: 1700000000 + id, message: `hi ${id}` });
    }
    await post({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 43, message_id: 103, time: 1700000103, message: 'from another peer' });

    const auth = { authorization: 'Bearer api-secret' };
    const beforeQuery = await (await fetch(`http://127.0.0.1:${port}/api/messages?unread=true&limit=10`, { headers: auth })).json() as { total: number };
    assert.equal(beforeQuery.total, 3);

    await post({ post_type: 'message_sent', message_type: 'private', self_id: 10001, user_id: 10001, target_id: 42, message_id: 104, time: 1700000200, message: 'my reply' });

    const afterQuery = await (await fetch(`http://127.0.0.1:${port}/api/messages?unread=true&limit=10`, { headers: auth })).json() as { total: number; messages: { peer_user_id: string }[] };
    assert.equal(afterQuery.total, 1, 'only the untouched peer stays unread');
    assert.equal(afterQuery.messages[0]!.peer_user_id, '43');
  } finally { await runtime.close(); }
});
