import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';

function incoming() {
  return normalizeEvent('main', 'napcat', 'fixture', { post_type: 'message', message_type: 'private', self_id: '100', user_id: '200', message_id: 5, time: 1700000000, message: 'hello' })!;
}

test('new incoming message defaults unread and agent processing never marks QQ read', () => {
  const store = new MessageStore(); const message = incoming(); store.insert(message);
  assert.deepEqual(store.state(message.id), { unread: true, seen_by_agent: false, processed: false, dismissed: false, qq_read: false });
  assert.deepEqual(store.markProcessed(message.id), { unread: false, seen_by_agent: true, processed: true, dismissed: false, qq_read: false });
});

test('dismissed state remains separate from processed state', () => {
  const store = new MessageStore(); const message = incoming(); store.insert(message);
  assert.deepEqual(store.dismiss(message.id), { unread: false, seen_by_agent: true, processed: false, dismissed: true, qq_read: false });
});

test('unknown message state cannot be updated', () => {
  const store = new MessageStore();
  assert.equal(store.markProcessed('missing'), undefined);
});
