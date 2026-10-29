import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresNotificationQueue } from '../src/notification-queue.js';

test('enqueue stores only event/reference metadata and clamps max attempts', async () => {
  let sql = ''; let values: unknown[] = [];
  const store = new PostgresNotificationQueue({ async query(text: string, params: unknown[] = []) { sql = text; values = params; return { rows: [{ id: '1', event: 'message.received', account_id: 'a', message_id: 'm', status: 'pending', attempts: 0, max_attempts: 20, run_after: new Date(0), lease_token: null }] }; } });
  const item = await store.enqueue({ event: 'message.received', accountId: 'a', messageId: 'm', dedupeKey: 'a:m', maxAttempts: 900 });
  assert.match(sql, /INSERT INTO notification_queue/);
  assert.deepEqual(values.slice(0, 5), ['message.received', 'a', 'm', 'a:m', 20]);
  assert.equal(JSON.stringify(values).includes('webhook'), false);
  assert.equal(item.messageId, 'm');
  assert.equal(item.maxAttempts, 20);
});

test('claim uses skip-locked expired lease recovery and bounds the lease', async () => {
  let sql = ''; let values: unknown[] = [];
  const store = new PostgresNotificationQueue({ async query(text: string, params: unknown[] = []) { sql = text; values = params; return { rows: [{ id: '1', event: 'e', account_id: null, message_id: null, status: 'processing', attempts: 1, max_attempts: 5, run_after: new Date(0), lease_token: params[0] }] }; } }, () => 'lease-secret');
  const claim = await store.claim(99999);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /lease_until <= now\(\)/);
  assert.deepEqual(values, ['lease-secret', 3600]);
  assert.equal(claim?.leaseToken, 'lease-secret');
});

test('complete and retry are fenced by the current lease token', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const store = new PostgresNotificationQueue({ async query(text: string, values: unknown[] = []) { calls.push({ sql: text, values }); return { rows: [{ id: '1' }] }; } });
  assert.equal(await store.complete('1', 'fence'), true);
  assert.match(calls[0]!.sql, /lease_token=\$2/);
  assert.deepEqual(calls[0]!.values, ['1', 'fence']);
  assert.equal(await store.retry('1', 'fence', 'https://host/?token=secret', new Date(123)) , true);
  assert.match(calls[1]!.sql, /attempts >= max_attempts THEN 'failed'/);
  assert.deepEqual(calls[1]!.values.slice(0, 3), ['1', 'fence', new Date(123)]);
  assert.equal(calls[1]!.values[3], 'Notification delivery failed');
});

test('retry exhaustion ignores a future runAfter and marks terminal run_after due immediately', async () => {
  let sql = ''; let values: unknown[] = [];
  const store = new PostgresNotificationQueue({ async query(text: string, params: unknown[] = []) { sql = text; values = params; return { rows: [{ id: '1' }] }; } });
  const futureRunAfter = new Date('2099-01-01T00:00:00Z');
  assert.equal(await store.retry('1', 'fence', 'failure', futureRunAfter), true);
  assert.match(sql, /attempts >= max_attempts THEN 'failed'/);
  assert.match(sql, /WHEN attempts >= max_attempts THEN now\(\)/);
  assert.doesNotMatch(sql, /status='failed'/);
  assert.deepEqual(values.slice(0, 3), ['1', 'fence', futureRunAfter]);
});
test('claim marks expired final-attempt leases failed and clears their lease fields', async () => {
  let sql = '';
  const store = new PostgresNotificationQueue({ async query(text: string) { sql = text; return { rows: [] }; } });
  assert.equal(await store.claim(), null);
  assert.match(sql, /status = 'processing' AND lease_until <= now\(\)/);
  assert.match(sql, /attempts >= max_attempts/);
  assert.match(sql, /status='failed'/);
  assert.match(sql, /lease_token=NULL/);
  assert.match(sql, /lease_until=NULL/);
});

test('complete and retry require an unexpired lease to fence late workers', async () => {
  const statements: string[] = [];
  const store = new PostgresNotificationQueue({ async query(text: string) { statements.push(text); return { rows: [{ id: '1' }] }; } });
  await store.complete('1', 'token');
  await store.retry('1', 'token');
  assert.match(statements[0]!, /lease_until > now\(\)/);
  assert.match(statements[1]!, /lease_until > now\(\)/);
});

test('foreign/stale leases return false; absent claims return null', async () => {
  const store = new PostgresNotificationQueue({ async query() { return { rows: [] }; } });
  assert.equal(await store.complete('1', 'stale'), false);
  assert.equal(await store.retry('1', 'stale', 'error'), false);
  assert.equal(await store.claim(), null);
});

test('invalid enqueue data is rejected before SQL', async () => {
  let called = false;
  const store = new PostgresNotificationQueue({ async query() { called = true; return { rows: [] }; } });
  await assert.rejects(store.enqueue({ event: ' ', dedupeKey: 'x' }), /required/);
  await assert.rejects(store.enqueue({ event: 'x', dedupeKey: 'y', maxAttempts: 1.5 }), /integer/);
  assert.equal(called, false);
});


test('failed notifications can be inspected in bounded batches with sanitized error metadata', async () => {
  let sql = ''; let values: unknown[] = [];
  const store = new PostgresNotificationQueue({ async query(text: string, params: unknown[] = []) {
    sql = text; values = params;
    return { rows: [{ id: '1', event: 'message.received', account_id: 'a', message_id: 'm', status: 'failed', attempts: 5, max_attempts: 5, run_after: new Date(0), lease_token: null, last_error: 'HTTP 503' }] };
  } });
  const failed = await store.listFailed(999);
  assert.match(sql, /status = 'failed'/);
  assert.match(sql, /ORDER BY updated_at DESC/);
  assert.deepEqual(values, [100]);
  assert.equal(failed[0]?.attempts, 5);
  assert.equal(failed[0]?.lastError, 'HTTP 503');
});

test('manual retry requeues only terminal failures and resets their attempt budget', async () => {
  let sql = ''; let values: unknown[] = [];
  const store = new PostgresNotificationQueue({ async query(text: string, params: unknown[] = []) { sql = text; values = params; return { rows: [{ id: 'failed-1' }] }; } });
  assert.equal(await store.retryFailed('failed-1'), true);
  assert.match(sql, /status='pending'/);
  assert.match(sql, /attempts=0/);
  assert.match(sql, /WHERE id=\$1 AND status='failed'/);
  assert.deepEqual(values, ['failed-1']);
});
