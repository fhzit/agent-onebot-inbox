import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliverNotificationOnce } from '../src/notification-dispatch.js';

test('delivery invokes notifier once and lets permanent HTTP errors escape', async () => {
  let calls = 0;
  const notifier = async () => {
    calls += 1;
    throw new Error('HTTP 400');
  };

  await assert.rejects(deliverNotificationOnce(notifier), /HTTP 400/);
  assert.equal(calls, 1);
});

test('delivery returns notifier result without retrying', async () => {
  let calls = 0;
  const result = await deliverNotificationOnce(async () => {
    calls += 1;
    return 'delivered';
  });

  assert.equal(result, 'delivered');
  assert.equal(calls, 1);
});
