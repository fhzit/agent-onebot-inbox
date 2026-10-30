import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagedReverseWsClient } from '../src/reverse-ws.js';

test('managed Reverse WS delegates bounded reconnect policy and disposes each socket once', () => {
  const attempts: Array<{ connected: () => void; failed: () => void }> = [];
  const sockets: Array<{ closes: number; close: () => void }> = [];
  const timers: Array<{ run: () => void; delay: number; cancelled: boolean }> = [];
  const client = createManagedReverseWsClient({
    connect(events) {
      attempts.push(events);
      const socket = { closes: 0, close() { this.closes++; } };
      sockets.push(socket);
      return socket;
    },
    schedule(run, delay) {
      const timer = { run, delay, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    delayOptions: { baseDelayMs: 10, maxDelayMs: 15, jitterRatio: 0 },
    random: () => 0,
  });

  client.start();
  attempts[0]!.failed();
  attempts[0]!.failed(); // duplicate close/error notifications do not schedule twice
  assert.equal(sockets[0]!.closes, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.delay, 10);
  timers[0]!.run();
  assert.equal(attempts.length, 2);
  attempts[1]!.failed();
  assert.equal(timers[1]!.delay, 15); // policy's maximum is a hard cap
  timers[1]!.run();
  attempts[2]!.connected();
  assert.equal(client.currentSocket, sockets[2]);

  client.close();
  client.close();
  assert.equal(client.currentSocket, undefined);
  assert.equal(sockets[2]!.closes, 1);
  attempts[2]!.failed();
  assert.equal(timers.length, 2);
  assert.equal(client.isClosed, true);
});

test('closing with an outstanding reconnect cancels it and rejects late socket callbacks', () => {
  const attempts: Array<{ connected: () => void; failed: () => void }> = [];
  const sockets: Array<{ closes: number; close: () => void }> = [];
  const timers: Array<{ run: () => void; cancelled: boolean }> = [];
  const client = createManagedReverseWsClient({
    connect(events) {
      attempts.push(events);
      const socket = { closes: 0, close() { this.closes++; } };
      sockets.push(socket);
      return socket;
    },
    schedule(run) {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    random: () => 0,
  });
  client.start();
  attempts[0]!.failed();
  client.close();
  assert.equal(timers[0]!.cancelled, true);
  timers[0]!.run();
  attempts[0]!.connected();
  assert.equal(attempts.length, 1);
  assert.equal(client.currentSocket, undefined);
  assert.equal(sockets[0]!.closes, 1);
});
