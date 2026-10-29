import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { PostgresNotificationQueue } from '../src/notification-queue.js';
import { PostgresMessageNotificationOutbox } from '../src/message-notification-outbox.js';

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;

test('PostgreSQL notification queue recovers expired final leases and reconciles missing message notifications', { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl, 'NOTIFICATION_TEST_DATABASE_URL must target the disposable CI PostgreSQL service');
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const schema = `notification_it_${process.pid}_${Date.now()}`;
  const db = {
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      return pool.query<T>(text.replace(/\bnotification_queue\b/g, `${schema}.notification_queue`).replace(/\bmessages\b/g, `${schema}.messages`), values);
    },
  };
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.notification_queue (
      id bigserial PRIMARY KEY, event text NOT NULL, account_id text, message_id text, dedupe_key text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
      attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
      run_after timestamptz NOT NULL DEFAULT now(), lease_token text, lease_until timestamptz,
      last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
    )`);
    await pool.query(`CREATE TABLE ${schema}.messages (id text PRIMARY KEY, account_id text NOT NULL, direction text NOT NULL, received_at timestamptz NOT NULL DEFAULT now())`);

    const queue = new PostgresNotificationQueue(db, () => 'new-lease');
    const expired = await queue.enqueue({ event: 'message.received', accountId: 'ci-account', messageId: 'expired', dedupeKey: 'expired-final', maxAttempts: 2 });
    await pool.query(`UPDATE ${schema}.notification_queue SET status='processing', attempts=2, lease_token='expired-lease', lease_until=now()-interval '1 second' WHERE id=$1`, [expired.id]);
    assert.equal(await queue.claim(), null, 'expired item at max attempts is failed instead of claimed again');
    const [failed] = await pool.query<{ status: string; attempts: number; lease_token: string | null }>(`SELECT status, attempts, lease_token FROM ${schema}.notification_queue WHERE id=$1`, [expired.id]).then(r => r.rows);
    assert.deepEqual(failed, { status: 'failed', attempts: 2, lease_token: null });

    await pool.query(`INSERT INTO ${schema}.messages(id, account_id, direction, received_at) VALUES
      ('missing-a','ci-account','incoming',now()-interval '2 seconds'),
      ('queued','ci-account','incoming',now()-interval '1 second'),
      ('outgoing','ci-account','outgoing',now())`);
    await pool.query(`INSERT INTO ${schema}.notification_queue(event,account_id,message_id,dedupe_key) VALUES ('message.received','ci-account','queued','message.received:queued')`);
    const outbox = new PostgresMessageNotificationOutbox(db);
    assert.deepEqual(await outbox.reconcile({ limit: 1, maxAttempts: 3 }), ['missing-a']);
    assert.deepEqual(await outbox.reconcile({ limit: 10, maxAttempts: 3 }), []);
    const rows = await pool.query<{ event: string; account_id: string; message_id: string; max_attempts: number }>(`SELECT event, account_id, message_id, max_attempts FROM ${schema}.notification_queue WHERE message_id='missing-a'`);
    assert.deepEqual(rows.rows, [{ event: 'message.received', account_id: 'ci-account', message_id: 'missing-a', max_attempts: 3 }]);
    const total = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${schema}.notification_queue`);
    assert.equal(total.rows[0]?.count, '3', 'only final-lease, pre-existing, and reconciled queue items exist');
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
