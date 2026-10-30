import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresMessageNotificationOutbox } from '../src/message-notification-outbox.js';
import { PostgresNotificationQueue } from '../src/notification-queue.js';

test('restart after delivery before acknowledgement retries the expired lease (at-least-once)', async () => {
  const row = {
    id: 'notification-1', event: 'message.received', account_id: 'account-1', message_id: 'message-1',
    status: 'pending', attempts: 0, max_attempts: 3, run_after: new Date(0), lease_token: null as string | null,
    lease_until: 0, last_error: null as string | null,
  };
  let now = 1_000;
  const db = {
    async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
      if (sql.includes('WITH exhausted AS')) {
        if (row.status === 'processing' && row.lease_until <= now) {
          row.lease_token = null;
          row.status = 'pending';
        }
        if (row.status !== 'pending' || row.run_after.getTime() > now) return { rows: [] as T[] };
        row.status = 'processing'; row.attempts += 1; row.lease_token = String(values[0]);
        row.lease_until = now + Number(values[1]) * 1000;
        return { rows: [{ id: row.id, event: row.event, account_id: row.account_id, message_id: row.message_id,
          status: row.status, attempts: row.attempts, max_attempts: row.max_attempts, run_after: row.run_after,
          lease_token: row.lease_token }] as T[] };
      }
      if (sql.includes("SET status='succeeded'")) {
        const owned = row.status === 'processing' && row.lease_token === values[1] && row.lease_until > now;
        if (owned) { row.status = 'succeeded'; row.lease_token = null; }
        return { rows: (owned ? [{ id: row.id }] : []) as T[] };
      }
      throw new Error(`Unexpected SQL in restart fixture: ${sql}`);
    },
  };
  const delivered: string[] = [];

  // First process delivers, then exits before recording completion.
  const firstProcess = new PostgresNotificationQueue(db, () => 'lease-before-crash');
  const firstClaim = await firstProcess.claim(1);
  assert.ok(firstClaim);
  delivered.push(firstClaim.messageId!);
  now += 1_001; // deterministic lease expiry; no wall-clock sleeps

  // A new process reclaims the durable row, so an external side effect can repeat.
  const restartedProcess = new PostgresNotificationQueue(db, () => 'lease-after-restart');
  const recovered = await restartedProcess.claim(1);
  assert.ok(recovered);
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.leaseToken, 'lease-after-restart');
  delivered.push(recovered.messageId!);
  assert.equal(await restartedProcess.complete(recovered.id, recovered.leaseToken), true);

  assert.deepEqual(delivered, ['message-1', 'message-1'], 'delivery is at-least-once, not exactly-once');
  assert.equal(row.status, 'succeeded');
  assert.equal(await restartedProcess.claim(), null);
});

test('outbox reconciliation remains idempotent across restart and enqueue dedupe collisions', async () => {
  const queuedMessageIds = new Set<string>();
  const outbox = new PostgresMessageNotificationOutbox({
    async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
      assert.match(sql, /ON CONFLICT\(dedupe_key\) DO NOTHING/);
      assert.match(sql, /NOT EXISTS/);
      // The fixture models the committed outbox row surviving process restart.
      const inserted = [...['message-1']].filter(id => !queuedMessageIds.has(id));
      for (const id of inserted) queuedMessageIds.add(id);
      assert.deepEqual(values, ['message.received', 5, 50]);
      return { rows: inserted.map(message_id => ({ message_id })) as T[] };
    },
  });

  assert.deepEqual(await outbox.reconcile(), ['message-1']);
  // A second process/reconciliation observes the existing event and inserts nothing.
  assert.deepEqual(await outbox.reconcile(), []);
  assert.equal(queuedMessageIds.size, 1);

  let storedKey = 'message.received:message-1';
  let writes = 0;
  const queue = new PostgresNotificationQueue({
    async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
      assert.match(sql, /ON CONFLICT\(dedupe_key\)/);
      writes += 1;
      storedKey = String(values[3]);
      return { rows: [{ id: 'stable-id', event: values[0], account_id: values[1], message_id: values[2],
        status: 'pending', attempts: 0, max_attempts: values[4], run_after: values[5], lease_token: null }] as T[] };
    },
  });
  const item = await queue.enqueue({ event: 'message.received', accountId: 'account-1', messageId: 'message-1', dedupeKey: storedKey });
  const duplicate = await queue.enqueue({ event: 'message.received', accountId: 'account-1', messageId: 'message-1', dedupeKey: storedKey });
  assert.equal(item.id, duplicate.id);
  assert.equal(writes, 2, 'upserts may repeat while the unique dedupe key preserves one logical row');
});
