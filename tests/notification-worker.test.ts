import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationWorker } from '../src/notification-worker.js';

test('worker retries failed deliveries using the claimed lease', async () => {
  const calls: string[] = []; let claimed = false;
  const queue = { async claim() { if (claimed) return null; claimed = true; return { id:'id', event:'e', accountId:'a', messageId:'m', status:'processing' as const, attempts:1, maxAttempts:2, runAfter:new Date(), leaseToken:'lease' }; }, async complete() { throw new Error('unexpected completion'); }, async retry(id:string, token:string) { calls.push(`retry:${id}:${token}`); return true; } } as never;
  const worker = new NotificationWorker(queue, async item => { calls.push(`deliver:${item.messageId}`); return false; }, 1);
  worker.start(); await new Promise(resolve => setTimeout(resolve, 10)); await worker.stop();
  assert.deepEqual(calls, ['deliver:m','retry:id:lease']);
});

test('worker completes successfully and stop waits for in-flight delivery', async () => {
  const calls: string[] = []; let claimed = false;
  const queue = { async claim() { if (claimed) return null; claimed = true; return { id:'id', event:'e', accountId:'a', messageId:'m', status:'processing' as const, attempts:1, maxAttempts:2, runAfter:new Date(), leaseToken:'t' }; }, async complete(id:string, token:string) { calls.push(`${id}:${token}`); return true; }, async retry() { throw new Error('unexpected retry'); } } as never;
  const worker = new NotificationWorker(queue, async () => true, 1);
  worker.start(); await new Promise(resolve => setTimeout(resolve, 10)); await worker.stop();
  assert.deepEqual(calls, ['id:t']);
});
