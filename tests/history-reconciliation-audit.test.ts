import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresHistoryReconciliationAudit } from '../src/history-reconciliation-audit.js';

test('history audit returns local consistency counts and makes no writes', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const db = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: [{ incoming_messages: '9', queued_notifications: 7, missing_notification_rows: '2' }] };
  } };
  const result = await new PostgresHistoryReconciliationAudit(db).report();
  assert.deepEqual(result, {
    mode: 'read_only_local_audit', providerHistoryAvailable: false,
    incomingMessages: 9, queuedNotifications: 7, missingNotificationRows: 2,
    scope: 'database_local_state_only',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /NOT EXISTS/);
  assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE/i);
  assert.equal(calls[0].values, undefined);
});

test('history audit rejects malformed database counts', async () => {
  const db = { query: async () => ({ rows: [{ incoming_messages: '-1', queued_notifications: 0, missing_notification_rows: 0 }] }) };
  await assert.rejects(new PostgresHistoryReconciliationAudit(db).report(), /invalid count/);
});

test('history audit fails closed when database returns no aggregate row', async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(new PostgresHistoryReconciliationAudit(db).report(), /no result/);
});
