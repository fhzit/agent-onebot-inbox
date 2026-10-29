import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagedReverseWsClient } from '../src/reverse-ws.js';

test('managed Reverse WS reconnects after failure, and shutdown cancels retry and closes socket', () => {
  const attempts: Array<{ connected: () => void; failed: () => void }> = [];
  const sockets: Array<{ closed: number; close: () => void }> = [];
  const jobs: Array<{ run: () => void; cancelled: boolean }> = [];
  const client = createManagedReverseWsClient({
    connect(events) {
      attempts.push(events);
      const socket = { closed: 0, close() { this.closed++; } };
      sockets.push(socket);
      return socket;
    },
    schedule(run) {
      const job = { run, cancelled: false };
      jobs.push(job);
      return () => { job.cancelled = true; };
    },
    random: () => 0,
  });
  client.start();
  assert.equal(attempts.length, 1);
  attempts[0]!.connected();
  assert.equal(client.currentSocket, sockets[0]);
  attempts[0]!.failed();
  assert.equal(sockets[0]!.closed, 1);
  assert.equal(jobs.length, 1);
  jobs[0]!.run();
  assert.equal(attempts.length, 2);
  attempts[1]!.connected();
  assert.equal(client.currentSocket, sockets[1]);
  client.close();
  assert.equal(client.currentSocket, undefined);
  assert.equal(sockets[1]!.closed, 1);
  attempts[1]!.failed();
  assert.equal(jobs.length, 1);
});

test('stale attempt callbacks cannot replace a newer socket', () => {
  const attempts: Array<{ connected: () => void; failed: () => void }> = [];
  const sockets: Array<{ closed: number; close: () => void }> = [];
  const jobs: Array<() => void> = [];
  const client = createManagedReverseWsClient({
    connect(events) {
      attempts.push(events);
      const socket = { closed: 0, close() { this.closed++; } };
      sockets.push(socket);
      return socket;
    },
    schedule(run) { jobs.push(run); return () => {}; },
    random: () => 0,
  });
  client.start();
  attempts[0]!.failed();
  jobs[0]!();
  attempts[1]!.connected();
  attempts[0]!.connected();
  assert.equal(sockets[0]!.closed, 1);
  assert.equal(client.currentSocket, sockets[1]);
  client.close();
});
