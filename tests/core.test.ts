import { createHash } from 'node:crypto';
import { normalizeEvent, normalizeSegments, priorityFor } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('at-all is never treated as at-me', () => {
  const message = normalizeEvent('main', 'napcat', 'ws', { post_type: 'message', message_type: 'group', self_id: '100', group_id: '200', user_id: '300', message_id: 1, message: [{ type: 'at', data: { qq: 'all' } }] });
  assert.equal(message?.at_all, true);
  assert.equal(message?.at_me, false);
});

test('mentions of current account are detected', () => {
  const message = normalizeEvent('main', 'napcat', 'ws', { post_type: 'message', message_type: 'group', self_id: '100', group_id: '200', user_id: '300', message_id: 2, message: [{ type: 'at', data: { qq: '100' } }] });
  assert.equal(message?.at_me, true);
  assert.equal(message?.priority_score, 25);
});

test('CQ code segments preserve unknown segment data', () => {
  assert.deepEqual(normalizeSegments('hi[CQ:weird,x=1]'), [{ type: 'text', data: { text: 'hi' } }, { type: 'weird', data: { x: '1' } }]);
});

test('fingerprint and stable normalized ID deduplicate repeated events', () => {
  const event = { post_type: 'message', message_type: 'private' as const, self_id: '100', user_id: '200', message_id: 7, time: 1700000000, message: 'hi' };
  const a = normalizeEvent('main', 'napcat', 'ws-a', event)!;
  const b = normalizeEvent('main', 'napcat', 'ws-b', event)!;
  assert.equal(a.event_fingerprint, b.event_fingerprint);
  assert.equal(a.id, b.id);
  const store = new MessageStore();
  assert.equal(store.insert(a).inserted, true);
  assert.equal(store.insert(b).inserted, false);
});

test('priority mapping is bounded and deterministic', () => {
  assert.equal(priorityFor(80), 'P0');
  assert.equal(priorityFor(60), 'P1');
  assert.equal(priorityFor(35), 'P2');
  assert.equal(priorityFor(15), 'P3');
  assert.equal(priorityFor(0), 'P4');
});

test('account config rejects duplicate ids and self IDs', () => {
  const base = { ACCOUNTS_JSON: JSON.stringify([{ id: 'a', alias: 'A', self_id: '1', provider: 'napcat' }, { id: 'b', alias: 'B', self_id: '1', provider: 'snowluma' }]) };
  assert.throws(() => loadConfig(base), /Duplicate self_id/);
});

test('fingerprint is SHA-256 hex', () => {
  const m = normalizeEvent('x', 'napcat', 'ws', { post_type: 'message', message_type: 'private', self_id: '1', user_id: '2', time: 1700000000, message: 'x' })!;
  assert.equal(m.event_fingerprint, createHash('sha256').update(JSON.stringify(['x', 'private', '2', '2', 1700000000, m.segments])).digest('hex'));
});
