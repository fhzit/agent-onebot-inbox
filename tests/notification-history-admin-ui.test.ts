import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminPage } from '../src/admin-page.js';

test('admin settings exposes failed notification listing and confirmed at-least-once retry UI', () => {
  assert.match(adminPage, /failedNotifications/);
  assert.ok(adminPage.includes('/api/admin/notifications/failed?limit=50'));
  assert.ok(adminPage.includes('/api/admin/notifications/failed/${encodeURIComponent(id)}/retry'));
  assert.match(adminPage, /at-least-once|重复投递/);
  assert.match(adminPage, /confirm\(/);
  assert.match(adminPage, /esc\(item\.lastError/);
});

test('admin settings exposes a refreshable notification delivery history view', () => {
  assert.match(adminPage, /notificationDeliveries/);
  assert.match(adminPage, /notificationDeliveriesRefresh/);
  assert.match(adminPage, /api\/admin\/notification-deliveries/);
  assert.match(adminPage, /loadNotificationDeliveries/);
});
