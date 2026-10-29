import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationDigests } from '../src/notification-digest.js';

test('batches message notifications by account with bounded chunks and stable ordering', () => {
  const result = buildNotificationDigests([
    { id: '1', event: 'message.received', accountId: 'a', messageId: 'm1' },
    { id: '2', event: 'message.received', accountId: 'b', messageId: 'm2' },
    { id: '3', event: 'message.received', accountId: 'a', messageId: 'm3' },
  ], 1);
  assert.deepEqual(result, [
    { accountId: 'a', count: 1, notificationIds: ['1'], messageIds: ['m1'] },
    { accountId: 'a', count: 1, notificationIds: ['3'], messageIds: ['m3'] },
    { accountId: 'b', count: 1, notificationIds: ['2'], messageIds: ['m2'] },
  ]);
});

test('rejects invalid batch limits', () => {
  assert.throws(() => buildNotificationDigests([], 0), /positive integer/);
});
