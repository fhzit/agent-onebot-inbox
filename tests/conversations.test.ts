import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';
import { startServer } from '../src/server.js';

const account = { id: 'acc', alias: '主号', self_id: '1001', provider: 'napcat' as const, enabled: true, permission: 'readonly' as const, access_token: 'token' };

function groupMessage(sequence: number, groupId: string, text: string, sender = '2002') {
  const message = normalizeEvent('acc', 'napcat', 'fixture', {
    post_type: 'message', message_type: 'group', self_id: '1001', group_id: groupId,
    user_id: sender, message_id: sequence, time: 1_700_000_000 + sequence, message: text,
    sender: { nickname: `成员${sender}` },
  });
  assert.ok(message);
  return message;
}

function privateMessage(sequence: number, userId: string, text: string) {
  const message = normalizeEvent('acc', 'napcat', 'fixture', {
    post_type: 'message', message_type: 'private', self_id: '1001', user_id: userId,
    message_id: sequence, time: 1_700_000_000 + sequence, message: text,
    sender: { nickname: '私聊对象' },
  });
  assert.ok(message);
  return message;
}

function seeded(): MessageStore {
  const store = new MessageStore();
  // group A: three messages, the middle one is the newest overall
  for (const [index, text] of ['群消息一', '群消息二', '群消息三'].entries()) store.insert(groupMessage(index + 1, '555', text));
  // private B: two messages
  for (const [index, text] of ['私聊一', '私聊二'].entries()) store.insert(privateMessage(index + 10, '3003', text));
  return store;
}

test('conversations collapse each group and private chat into a single row', () => {
  const store = seeded();
  const result = store.conversations();
  assert.equal(result.total, 2);
  assert.equal(result.conversations.length, 2);
  const group = result.conversations.find(row => row.type === 'group');
  const direct = result.conversations.find(row => row.type === 'private');
  assert.ok(group && direct);
  assert.equal(group.conversation_id, groupMessage(1, '555', 'x').conversation_id);
  assert.equal(group.message_count, 3);
  assert.equal(group.unread_count, 3);
  assert.equal(group.last_message.plain_text, '群消息三');
  assert.equal(group.group_id, '555');
  assert.equal(direct.message_count, 2);
  assert.equal(direct.title, '私聊对象');
  assert.equal(direct.peer_user_id, '3003');
});

test('conversations are ordered by the newest message and can be filtered by type', () => {
  const store = seeded();
  const newest = store.conversations().conversations[0];
  assert.equal(newest?.type, 'private');
  const groups = store.conversations({ type: 'group' });
  assert.equal(groups.total, 1);
  assert.equal(groups.conversations[0]?.group_id, '555');
  assert.equal(store.conversations({ account_id: 'missing' }).total, 0);
});

test('unread counters drop once the agent marks messages seen', () => {
  const store = seeded();
  const group = store.conversations().conversations.find(row => row.type === 'group')!;
  assert.equal(group.unread_count, 3);
  const thread = store.conversationMessages(group.conversation_id);
  store.markSeen(thread.messages[0]!.id);
  assert.equal(store.conversations().conversations.find(row => row.type === 'group')!.unread_count, 2);
});

test('thread pages backwards from a cursor and stays chronological', () => {
  const store = seeded();
  const groupId = groupMessage(1, '555', 'x').conversation_id;
  const latest = store.conversationMessages(groupId, { limit: 2 });
  assert.equal(latest.messages.length, 2);
  assert.equal(latest.messages[0]!.plain_text, '群消息二');
  assert.equal(latest.messages[1]!.plain_text, '群消息三');
  assert.equal(latest.has_more, true);
  const older = store.conversationMessages(groupId, { limit: 2, before: latest.messages[0]!.sent_at });
  assert.deepEqual(older.messages.map(message => message.plain_text), ['群消息一']);
  assert.equal(older.has_more, false);
});

test('conversation endpoints require auth and expose both rollups and threads', async () => {
  const runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'secret', maxMessageBytes: 100_000, logMessageContent: false, accounts: [account] });
  try {
    const address = runtime.address();
    assert.ok(address);
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/conversations`)).status, 401);

    const headers = { authorization: 'Bearer secret' };
    const listResponse = await fetch(`${base}/api/conversations?type=group`, { headers });
    assert.equal(listResponse.status, 200);
    const list = (await listResponse.json()) as { conversations: Array<{ conversation_id: string; message_count: number }>; total: number };
    assert.equal(list.total, 0);
    assert.deepEqual(list.conversations, []);

    assert.equal((await fetch(`${base}/api/conversations?type=channel`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/api/conversations/unknown/messages`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/conversations/x/messages?before=not-a-date`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/api/conversations/x/messages?limit=999`, { headers })).status, 400);
  } finally {
    await runtime.close();
  }
});
