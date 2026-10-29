import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PostgresMessageNotificationOutbox } from '../src/message-notification-outbox.js';

test('reconcile inserts bounded missing incoming message notifications idempotently', async () => {
  let sql = ''; let values: unknown[] = [];
  const outbox = new PostgresMessageNotificationOutbox({ async query(text: string, params: unknown[] = []) { sql = text; values = params; return { rows: [{ message_id: 'm1' }, { message_id: 'm2' }] }; } });
  assert.deepEqual(await outbox.reconcile({ limit: 12, maxAttempts: 3 }), ['m1', 'm2']);
  assert.match(sql, /INSERT INTO notification_queue/);
  assert.match(sql, /FROM messages m/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /ON CONFLICT\(dedupe_key\) DO NOTHING/);
  assert.deepEqual(values, ['message.received', 3, 12]);
});

test('reconcile clamps the batch bound and uses default attempts', async () => {
  let values: unknown[] = [];
  const outbox = new PostgresMessageNotificationOutbox({ async query(_text: string, params: unknown[] = []) { values = params; return { rows: [] }; } });
  assert.deepEqual(await outbox.reconcile({ limit: 10000 }), []);
  assert.deepEqual(values, ['message.received', 5, 100]);
});

test('reconcile rejects invalid attempt count without querying', async () => {
  let called = false;
  const outbox = new PostgresMessageNotificationOutbox({ async query() { called = true; return { rows: [] }; } });
  await assert.rejects(outbox.reconcile({ maxAttempts: 1.5 }), /maxAttempts must be an integer/);
  assert.equal(called, false);
});
