import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNotificationFailure, notificationRetryDelayMs } from '../src/notification-retry-policy.js';

test('HTTP transient failures include timeout, rate limit, and server errors', () => {
  for (const error of [new Error('Hermes webhook returned HTTP 408'), new Error('HTTP 429'), new Error('HTTP 503')]) {
    assert.deepEqual(classifyNotificationFailure(error), { retryable: true, category: 'transient', retryAfterMs: null });
  }
});

test('HTTP client failures are permanent while network and unknown errors are transient', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.deepEqual(classifyNotificationFailure(new Error(`HTTP ${status}`)), {
      retryable: false, category: 'permanent', retryAfterMs: null,
    });
  }
  assert.equal(classifyNotificationFailure(new TypeError('fetch failed')).retryable, true);
  assert.equal(classifyNotificationFailure('provider unavailable').category, 'transient');
});

test('HTTP status classification covers retryable boundaries and accepted message forms', () => {
  for (const status of [408, 429, 500, 599]) {
    assert.deepEqual(classifyNotificationFailure(new Error(`Hermes webhook returned HTTP ${status}`)), {
      retryable: true, category: 'transient', retryAfterMs: null,
    });
  }
  assert.deepEqual(classifyNotificationFailure(new Error('http 503: temporarily unavailable')), {
    retryable: true, category: 'transient', retryAfterMs: null,
  });
  assert.deepEqual(classifyNotificationFailure('status 503'), { retryable: true, category: 'transient', retryAfterMs: null });
  assert.deepEqual(classifyNotificationFailure(''), { retryable: true, category: 'transient', retryAfterMs: null });
  assert.deepEqual(classifyNotificationFailure(null), {
    retryable: true, category: 'transient', retryAfterMs: null,
  });
});

test('retry delays grow exponentially, cap, and stop on permanent errors or exhausted budget', () => {
  const transient = new Error('HTTP 503');
  assert.equal(notificationRetryDelayMs(1, transient), 5_000);
  assert.equal(notificationRetryDelayMs(2, transient), 10_000);
  assert.equal(notificationRetryDelayMs(4, transient, { maxAttempts: 10, maxDelayMs: 20_000 }), 20_000);
  assert.equal(notificationRetryDelayMs(5, transient, { maxAttempts: 5 }), null);
  assert.equal(notificationRetryDelayMs(1, new Error('HTTP 400')), null);
});

test('retry policy validates attempt and delay configuration', () => {
  assert.throws(() => notificationRetryDelayMs(0, 'failed'), /attempt/);
  assert.throws(() => notificationRetryDelayMs(1, 'failed', { baseDelayMs: -1 }), /baseDelayMs/);
});
