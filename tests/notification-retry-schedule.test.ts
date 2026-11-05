import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleNotificationRetry } from '../src/notification-retry-schedule.js';

const epoch = new Date('2025-01-01T00:00:00.000Z');

test('schedules transient retries with bounded exponential delay', () => {
  assert.equal(scheduleNotificationRetry(1, 'network unavailable', { now: epoch })?.toISOString(), '2025-01-01T00:00:05.000Z');
  assert.equal(scheduleNotificationRetry(3, 'HTTP 503', { now: epoch, baseDelayMs: 2_000 })?.toISOString(), '2025-01-01T00:00:08.000Z');
  assert.equal(scheduleNotificationRetry(4, 'network unavailable', { now: epoch, baseDelayMs: 5_000, maxDelayMs: 12_000 })?.toISOString(), '2025-01-01T00:00:12.000Z');
});

test('honors runAfter as a lower bound, even when it is later than the backoff', () => {
  const later = new Date(epoch.getTime() + 60_000);
  assert.equal(scheduleNotificationRetry(1, 'network unavailable', { now: epoch, runAfter: later })?.toISOString(), later.toISOString());
  const earlier = new Date(epoch.getTime() + 1_000);
  assert.equal(scheduleNotificationRetry(1, 'network unavailable', { now: epoch, runAfter: earlier })?.toISOString(), '2025-01-01T00:00:05.000Z');
});

test('does not schedule permanent failures or exhausted attempts', () => {
  assert.equal(scheduleNotificationRetry(1, 'HTTP 400', { now: epoch }), null);
  assert.equal(scheduleNotificationRetry(5, 'network unavailable', { now: epoch, maxAttempts: 5 }), null);
});
