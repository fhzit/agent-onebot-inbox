import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';

test('message_sent private is stored as outgoing from the account to the counterpart', () => {
  const message = normalizeEvent('main', 'napcat', 'ws', {
    post_type: 'message_sent', message_type: 'private', self_id: '100',
    user_id: '100', target_id: '300', message_id: 900, time: 1700000400, message: '我已经回了',
  })!;
  assert.equal(message.direction, 'outgoing');
  assert.equal(message.sender_id, '100');
  assert.equal(message.peer_user_id, '300');
  assert.equal(message.conversation_id, 'main:private:300');
  assert.equal(message.at_me, false);
  assert.equal(message.priority, 'P4');
  assert.equal(message.sender_name, '我');
});

test('message_sent group keeps the group as the conversation and is not treated as an incoming message', () => {
  const message = normalizeEvent('main', 'napcat', 'ws', {
    post_type: 'message_sent', message_type: 'group', self_id: '100',
    user_id: '100', group_id: '200', message_id: 901, time: 1700000401,
    message: [{ type: 'at', data: { qq: '100' } }],
  })!;
  assert.equal(message.direction, 'outgoing');
  assert.equal(message.group_id, '200');
  assert.equal(message.peer_user_id, null);
  assert.equal(message.conversation_id, 'main:group:200');
  assert.equal(message.at_me, false);
});

test('incoming events still normalize as incoming', () => {
  const message = normalizeEvent('main', 'napcat', 'ws', {
    post_type: 'message', message_type: 'private', self_id: '100', user_id: '300',
    message_id: 902, time: 1700000402, message: '在吗',
  })!;
  assert.equal(message.direction, 'incoming');
  assert.equal(message.peer_user_id, '300');
  assert.equal(message.priority, 'P3');
});

test('query filters by direction so a caller can ask only for my own replies', () => {
  const store = new MessageStore();
  const incoming = normalizeEvent('main', 'napcat', 'ws', {
    post_type: 'message', message_type: 'private', self_id: '100', user_id: '300',
    message_id: 903, time: 1700000500, message: '在吗',
  })!;
  const outgoing = normalizeEvent('main', 'napcat', 'ws', {
    post_type: 'message_sent', message_type: 'private', self_id: '100', user_id: '100',
    target_id: '300', message_id: 904, time: 1700000600, message: '回了',
  })!;
  store.insert(incoming);
  store.insert(outgoing);
  assert.equal(store.query({ direction: 'outgoing' }).total, 1);
  assert.equal(store.query({ direction: 'incoming' }).total, 1);
  assert.equal(store.query({}).total, 2);
});
