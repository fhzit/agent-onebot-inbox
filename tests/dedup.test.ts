import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';

test('same message without provider timestamp deduplicates across transports', () => {
  const event = { post_type: 'message', message_type: 'private' as const, self_id: '1', user_id: '2', message_id: 42, message: 'repeat' };
  const a = normalizeEvent('a', 'napcat', 'http', event)!;
  const b = normalizeEvent('a', 'napcat', 'napcat-ws', event)!;
  const store = new MessageStore();
  assert.equal(store.insert(a).inserted, true);
  assert.equal(store.insert(b).inserted, false);
});

test('equal timestamp-less content without external id shares fingerprint', () => {
  const event = { post_type: 'message', message_type: 'group' as const, self_id: '1', group_id: '9', user_id: '2', message: 'same' };
  const a = normalizeEvent('a', 'napcat', 'http', event)!;
  const b = normalizeEvent('a', 'napcat', 'ws', event)!;
  assert.equal(a.event_fingerprint, b.event_fingerprint);
});
