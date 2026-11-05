import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresNotificationQueue, type ClaimedNotification, type EnqueueNotification, type FailedNotification, type NotificationQueueItem } from '../src/notification-queue.js';

/** Adapter contract required by workers and admin retry endpoints. */
interface QueueStore {
  enqueue(input: EnqueueNotification): Promise<NotificationQueueItem>;
  claim(leaseSeconds?: number): Promise<ClaimedNotification | null>;
  renew(id: string, leaseToken: string, leaseSeconds?: number): Promise<boolean>;
  complete(id: string, leaseToken: string): Promise<boolean>;
  retry(id: string, leaseToken: string, error?: string | null, runAfter?: Date): Promise<boolean>;
  listFailed(limit?: number): Promise<FailedNotification[]>;
  retryFailed(id: string): Promise<boolean>;
}

// Compile-time conformance: any future adapter must provide the entire contract.
const makeQueue = (db: ConstructorParameters<typeof PostgresNotificationQueue>[0]) => new PostgresNotificationQueue(db);
const postgresFactory: (db: ConstructorParameters<typeof PostgresNotificationQueue>[0]) => QueueStore = makeQueue;
void postgresFactory;

test('QueueStore conformance: enqueue is deduplicated, leases are fenced, and failures are administrable', async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let claimed = false;
  const db = {
    async query(text: string, values: unknown[] = []) {
      statements.push({ sql: text, values });
      if (text.includes('INSERT INTO notification_queue')) return { rows: [{ id: 'n1', event: 'message.received', account_id: 'a1', message_id: 'm1', status: 'pending', attempts: 0, max_attempts: 5, run_after: new Date(0), lease_token: null }] };
      if (text.includes('FOR UPDATE SKIP LOCKED')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [{ id: 'n1', event: 'message.received', account_id: 'a1', message_id: 'm1', status: 'processing', attempts: 1, max_attempts: 5, run_after: new Date(0), lease_token: values[0] }] };
      }
      if (text.startsWith('SELECT attempts')) return { rows: [{ attempts: 1, max_attempts: 5 }] };
      if (text.startsWith('UPDATE notification_queue SET lease_until')) return { rows: [] };
      if (text.startsWith('UPDATE notification_queue SET status=\'succeeded\'')) return { rows: values[1] === 'lease-A' ? [{ id: 'n1' }] : [] };
      if (text.includes("status='failed'")) return { rows: [{ id: 'n1' }] };
      if (text.includes('last_error')) return { rows: [{ id: 'n1', event: 'message.received', account_id: 'a1', message_id: 'm1', status: 'failed', attempts: 5, max_attempts: 5, run_after: new Date(0), lease_token: null, last_error: 'HTTP 503' }] };
      return { rows: [{ id: 'n1' }] };
    },
  };
  const queue: QueueStore = new PostgresNotificationQueue(db, () => 'lease-A');
  const item = await queue.enqueue({ event: 'message.received', accountId: 'a1', messageId: 'm1', dedupeKey: 'a1:m1' });
  assert.equal(item.id, 'n1');
  assert.match(statements[0]!.sql, /ON CONFLICT\(dedupe_key\)/);

  const claim = await queue.claim(30);
  assert.equal(claim?.leaseToken, 'lease-A');
  assert.equal(await queue.claim(), null);
  assert.equal(await queue.renew('n1', 'stale'), false);
  assert.equal(await queue.complete('n1', 'stale'), false);
  assert.equal(await queue.complete('n1', 'lease-A'), true);
  assert.match(statements.find((s) => s.sql.includes("SET status='succeeded'"))!.sql, /lease_token=\$2.*lease_until > now\(\)/s);
  assert.equal(await queue.retry('n1', 'lease-A', 'HTTP 503'), true);
  assert.equal(await queue.retryFailed('n1'), true);
  const failed = await queue.listFailed(5);
  assert.equal(failed[0]?.lastError, 'HTTP 503');
});
