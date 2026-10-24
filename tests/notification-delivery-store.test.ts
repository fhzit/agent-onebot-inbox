import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresNotificationDeliveryStore, type NotificationDelivery } from '../src/notification-delivery-store.js';

test('delivery history persists only secret-free delivery metadata', async () => {
  let queryText = '';
  let values: unknown[] = [];
  const store = new PostgresNotificationDeliveryStore({
    async query(text: string, params: unknown[] = []) {
      queryText = text;
      values = params;
      return { rows: [{ id: 'd1', event: 'message.received', account_id: 'a1', message_id: 'm1', outcome: 'failure', http_status: 503, error: 'HTTP 503', created_at: new Date('2025-01-01T00:00:00Z') }] };
    },
  });
  const delivery: NotificationDelivery = { event: 'message.received', accountId: 'a1', messageId: 'm1', outcome: 'failure', httpStatus: 503, error: 'HTTP 503' };
  const saved = await store.record(delivery);
  assert.match(queryText, /INSERT INTO notification_deliveries/);
  assert.deepEqual(values, ['message.received', 'a1', 'm1', 'failure', 503, 'HTTP 503']);
  assert.equal(JSON.stringify(values).includes('secret'), false);
  assert.equal(saved.id, 'd1');
  assert.equal(saved.outcome, 'failure');
});

test('delivery history query returns newest records with a bounded limit', async () => {
  let values: unknown[] = [];
  const store = new PostgresNotificationDeliveryStore({
    async query(_text: string, params: unknown[] = []) { values = params; return { rows: [] }; },
  });
  assert.deepEqual(await store.list(10000), []);
  assert.deepEqual(values, [100]);
});
