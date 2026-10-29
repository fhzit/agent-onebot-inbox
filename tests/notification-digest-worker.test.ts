import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationDigestWorker } from '../src/notification-digest-worker.js';

test('flush delivers bounded digest and completes every claimed message notification', async () => {
  const rows = [1, 2, 3].map(n => ({ id: `n${n}`, event: 'message.received', accountId: n < 3 ? 'a' : 'b', messageId: `m${n}`, status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: `l${n}` }));
  const calls: string[] = []; const digests: unknown[] = [];
  const queue = { async claim() { return rows.shift() ?? null; }, async complete(id: string, token: string) { calls.push(`complete:${id}:${token}`); return true; }, async retry(id: string) { calls.push(`retry:${id}`); return true; } };
  const worker = new NotificationDigestWorker(queue, async digest => { digests.push(digest); return true; }, 1);
  assert.equal(await worker.flush(10), 3);
  assert.deepEqual(digests, [
    { accountId: 'a', count: 1, notificationIds: ['n1'], messageIds: ['m1'] },
    { accountId: 'a', count: 1, notificationIds: ['n2'], messageIds: ['m2'] },
    { accountId: 'b', count: 1, notificationIds: ['n3'], messageIds: ['m3'] },
  ]);
  assert.deepEqual(calls, ['complete:n1:l1', 'complete:n2:l2', 'complete:n3:l3']);
});

test('unsupported row retry failure does not prevent later claims from being processed', async () => {
  const rows = [
    { id: 'bad', event: 'unsupported', accountId: null, messageId: null, status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'lb' },
    { id: 'good', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'lg' },
  ];
  const calls: string[] = [];
  const queue = {
    async claim() { return rows.shift() ?? null; },
    async complete(id: string, token: string) { calls.push(`complete:${id}:${token}`); return true; },
    async retry(id: string, token: string) { calls.push(`retry:${id}:${token}`); throw new Error('database unavailable'); },
  };
  const worker = new NotificationDigestWorker(queue, async () => true);
  assert.equal(await worker.flush(), 1);
  assert.deepEqual(calls, ['retry:bad:lb', 'complete:good:lg']);
});

test('delivery is not counted when any completion transition throws', async () => {
  let claimed = false;
  const row = { id: 'n', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'lease' };
  const queue = {
    async claim() { if (claimed) return null; claimed = true; return row; },
    async complete() { throw new Error('database unavailable'); },
    async retry() { return true; },
  };
  const worker = new NotificationDigestWorker(queue, async () => true);
  assert.equal(await worker.flush(), 0);
});

test('failed digest delivery retries its leased rows', async () => {
  let claimed = true; const retries: string[] = [];
  const row = { id: 'n', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'lease' };
  const queue = { async claim() { if (!claimed) return null; claimed = false; return row; }, async complete() { throw new Error('unexpected'); }, async retry(id: string, token: string) { retries.push(`${id}:${token}`); return true; } };
  const worker = new NotificationDigestWorker(queue, async () => false);
  assert.equal(await worker.flush(), 0);
  assert.deepEqual(retries, ['n:lease']);
});

test('stale lease completion is not counted as successful delivery', async () => {
  let claimed = false;
  const row = { id: 'n', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'expired-lease' };
  const queue = { async claim() { if (claimed) return null; claimed = true; return row; }, async complete() { return false; }, async retry() { throw new Error('must not retry a delivered item'); } };
  const worker = new NotificationDigestWorker(queue, async () => true);
  assert.equal(await worker.flush(), 0);
});

test('renews leases during a slow digest delivery', async () => {
  let claimed = false;
  const renewed: string[] = [];
  const row = { id: 'n', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'lease' };
  const queue = {
    async claim() { if (claimed) return null; claimed = true; return row; },
    async renew(id: string, token: string) { renewed.push(`${id}:${token}`); return true; },
    async complete() { return true; }, async retry() { return true; },
  };
  const worker = new NotificationDigestWorker(queue, async () => {
    await new Promise(resolve => setTimeout(resolve, 280));
    return true;
  }, 20, 1);
  assert.equal(await worker.flush(), 1);
  assert.ok(renewed.length >= 1);
  assert.deepEqual(renewed, ['n:lease']);
});

test('lease renewal failure prevents marking digest delivered', async () => {
  let claimed = false;
  let completed = false;
  const row = { id: 'n', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'lease' };
  const queue = {
    async claim() { if (claimed) return null; claimed = true; return row; },
    async renew() { return false; }, async complete() { completed = true; return true; }, async retry() { return true; },
  };
  const worker = new NotificationDigestWorker(queue, async () => {
    await new Promise(resolve => setTimeout(resolve, 280));
    return true;
  }, 20, 1);
  assert.equal(await worker.flush(), 0);
  assert.equal(completed, false);
});

test('stale lease retry rejection is contained and is not counted as delivery', async () => {
  let claimed = false;
  const row = { id: 'n', event: 'message.received', accountId: 'a', messageId: 'm', status: 'processing' as const, attempts: 1, maxAttempts: 5, runAfter: new Date(), leaseToken: 'expired-lease' };
  const queue = { async claim() { if (claimed) return null; claimed = true; return row; }, async complete() { throw new Error('unexpected'); }, async retry() { return false; } };
  const worker = new NotificationDigestWorker(queue, async () => false);
  assert.equal(await worker.flush(), 0);
});
