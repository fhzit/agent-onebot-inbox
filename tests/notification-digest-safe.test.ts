import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeNotificationDigests } from '../src/notification-digest-safe.js';

const message = (id: string, accountId: string | null, messageId: string | null = id) => ({
  id,
  event: 'message.received',
  accountId,
  messageId,
});

test('keeps null and empty account IDs separate and preserves each account order', () => {
  assert.deepEqual(buildSafeNotificationDigests([
    message('null-1', null),
    message('empty', ''),
    message('null-2', null),
  ], 1), [
    { accountId: null, count: 1, notificationIds: ['null-1'], messageIds: ['null-1'] },
    { accountId: null, count: 1, notificationIds: ['null-2'], messageIds: ['null-2'] },
    { accountId: '', count: 1, notificationIds: ['empty'], messageIds: ['empty'] },
  ]);
});

test('caps each digest and excludes unrelated events while retaining notification IDs', () => {
  assert.deepEqual(buildSafeNotificationDigests([
    message('1', 'acct', null),
    { id: 'skip', event: 'message.edited', accountId: 'acct', messageId: 'edited' },
    message('2', 'acct', 'm2'),
    message('3', 'acct', 'm3'),
  ], 2), [
    { accountId: 'acct', count: 2, notificationIds: ['1', '2'], messageIds: ['m2'] },
    { accountId: 'acct', count: 1, notificationIds: ['3'], messageIds: ['m3'] },
  ]);
});

test('rejects non-positive, fractional, and unsafe batch sizes', () => {
  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => buildSafeNotificationDigests([], limit), /positive safe integer/);
  }
});
