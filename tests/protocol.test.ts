import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';

test('same message without provider timestamp deduplicates across transports', () => {
  const event = { post_type: 'message', message_type: 'private' as const, self_id: '100', user_id: '200', message_id: 7, message: 'hello' };
  const http = normalizeEvent('main', 'napcat', 'http:main', event)!;
  const ws = normalizeEvent('main', 'napcat', 'reverse-ws:main', event)!;
  assert.equal(http.event_fingerprint, ws.event_fingerprint);
  const store = new MessageStore();
  assert.equal(store.insert(http).inserted, true);
  assert.equal(store.insert(ws).inserted, false);
});
