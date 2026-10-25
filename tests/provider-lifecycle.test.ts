import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderLifecycle } from '../src/provider-lifecycle.js';

test('retries a failed attempt with bounded jitter and resets delay after success', () => {
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const attempts: Array<{ connected: () => void; failed: () => void }> = [];
  const lifecycle = createProviderLifecycle({
    connect: (events) => { attempts.push(events); },
    schedule: (callback, delay) => { timers.push({ callback, delay }); return () => {}; },
    delayOptions: { baseDelayMs: 10, maxDelayMs: 25, jitterRatio: 0.2 },
    random: () => 1,
  });
  lifecycle.start();
  attempts[0]!.failed();
  assert.equal(timers[0]!.delay, 12);
  timers[0]!.callback();
  attempts[1]!.failed();
  assert.equal(timers[1]!.delay, 24);
  timers[1]!.callback();
  attempts[2]!.connected();
  attempts[2]!.failed();
  assert.equal(timers[2]!.delay, 12);
});

test('ignores stale attempt events and cancels retries on close', () => {
  const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
  const attempts: Array<{ connected: () => void; failed: () => void }> = [];
  let connects = 0;
  const lifecycle = createProviderLifecycle({
    connect: (events) => { attempts.push(events); connects++; },
    schedule: (callback) => { const timer = { callback, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  });
  lifecycle.start();
  attempts[0]!.failed();
  timers[0]!.callback();
  attempts[0]!.connected();
  attempts[0]!.failed();
  assert.equal(timers.length, 1);
  attempts[1]!.failed();
  lifecycle.close();
  assert.equal(timers[1]!.cancelled, true);
  timers[1]!.callback();
  assert.equal(connects, 2);
  lifecycle.start();
  assert.equal(connects, 2);
});

test('start is idempotent while an attempt is active', () => {
  let count = 0;
  const lifecycle = createProviderLifecycle({
    connect: () => { count++; },
    schedule: () => () => {},
  });
  lifecycle.start();
  lifecycle.start();
  assert.equal(count, 1);
});
