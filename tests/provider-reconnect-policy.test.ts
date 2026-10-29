import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconnectDelayMs, createReconnectLifecycle } from '../src/provider-reconnect-policy.js';

test('reconnect delay grows exponentially, caps, and applies injected bounded jitter', () => {
  const options = { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0.2 };
  assert.equal(reconnectDelayMs(0, options, () => 0), 80);
  assert.equal(reconnectDelayMs(1, options, () => 0.5), 200);
  assert.equal(reconnectDelayMs(20, options, () => 1), 500);
});

test('delay rejects invalid retry indexes and jitter samples', () => {
  assert.throws(() => reconnectDelayMs(-1), RangeError);
  assert.throws(() => reconnectDelayMs(0, undefined, () => 1.1), RangeError);
});

test('lifecycle resets failures on success and close cancels pending retry', () => {
  const scheduled: Array<{ callback: () => void; cancelled: boolean }> = [];
  let attempts = 0;
  const lifecycle = createReconnectLifecycle({
    schedule(callback) { const entry = { callback, cancelled: false }; scheduled.push(entry); return () => { entry.cancelled = true; }; },
    connect() { attempts++; },
    delayOptions: { baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    random: () => 0.5,
  });
  lifecycle.start();
  assert.equal(attempts, 1);
  lifecycle.failed();
  assert.equal(scheduled[0]!.cancelled, false);
  scheduled[0]!.callback();
  assert.equal(attempts, 2);
  lifecycle.connected();
  lifecycle.failed();
  assert.equal(scheduled[1]!.cancelled, false);
  lifecycle.close();
  assert.equal(scheduled[1]!.cancelled, true);
  scheduled[1]!.callback();
  lifecycle.start();
  assert.equal(attempts, 2);
});

test('lifecycle handles a schedule callback invoked synchronously', () => {
  let attempts = 0;
  const lifecycle = createReconnectLifecycle({
    schedule(callback) { callback(); return () => {}; },
    connect() { attempts++; },
    delayOptions: { baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  });
  lifecycle.failed();
  lifecycle.failed();
  assert.equal(attempts, 2);
});

test('connected cancels and invalidates a pending retry', () => {
  let callback!: () => void;
  let cancelled = false;
  let attempts = 0;
  const lifecycle = createReconnectLifecycle({
    schedule(cb) { callback = cb; return () => { cancelled = true; }; },
    connect() { attempts++; },
    delayOptions: { baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  });
  lifecycle.failed();
  lifecycle.connected();
  callback();
  assert.equal(cancelled, true);
  assert.equal(attempts, 0);
});
