import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderSessionLiveness, type LivenessSocket } from '../src/provider-session-liveness.js';

function harness() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const sent: string[] = [];
  const listeners = new Set<(payload: Buffer) => void>();
  let lastPing: Buffer | undefined;
  let terminated = 0;
  let throwOnPing = false;
  const socket: LivenessSocket = {
    ping: (payload) => { sent.push('ping'); lastPing = payload; if (throwOnPing) throw new Error('ping failed'); },
    terminate: () => { terminated++; },
    on: (_event, listener) => { listeners.add(listener); },
    off: (_event, listener) => { listeners.delete(listener); },
  };
  const schedule = (callback: () => void, delay: number) => {
    const key = ++id;
    timers.set(key, { at: now + delay, callback });
    return () => timers.delete(key);
  };
  const advance = (ms: number) => {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback();
    }
    now = end;
  };
  const pong = (payload?: Buffer) => { for (const listener of [...listeners]) listener(payload ?? lastPing ?? Buffer.alloc(0)); };
  const unsolicitedPong = () => pong(Buffer.from('not-our-ping'));
  return { socket, schedule, advance, pong, unsolicitedPong, sent, set throwOnPing(value: boolean) { throwOnPing = value; }, get terminated() { return terminated; } };
}

test('sends control ping, accepts pong, and keeps session alive', () => {
  const h = harness(); let timeouts = 0;
  const life = createProviderSessionLiveness({ socket: h.socket, schedule: h.schedule, intervalMs: 10, timeoutMs: 5, onTimeout: () => timeouts++ });
  h.advance(10); assert.deepEqual(h.sent, ['ping']);
  h.advance(4); h.pong();
  h.advance(10); assert.deepEqual(h.sent, ['ping', 'ping']);
  h.pong(); h.advance(5);
  assert.equal(timeouts, 0); assert.equal(h.terminated, 0);
  life.stop();
});

test('terminates session when pong is not received by timeout', () => {
  const h = harness(); let timeouts = 0;
  createProviderSessionLiveness({ socket: h.socket, schedule: h.schedule, intervalMs: 10, timeoutMs: 5, onTimeout: () => timeouts++ });
  h.advance(15);
  assert.equal(timeouts, 1); assert.equal(h.terminated, 1);
  h.pong(); h.advance(100);
  assert.deepEqual(h.sent, ['ping']); assert.equal(timeouts, 1);
});

test('ignores unsolicited pong and times out the outstanding ping', () => {
  const h = harness(); let timeouts = 0;
  createProviderSessionLiveness({ socket: h.socket, schedule: h.schedule, intervalMs: 10, timeoutMs: 5, onTimeout: () => timeouts++ });
  h.advance(10); h.unsolicitedPong(); h.advance(5);
  assert.equal(timeouts, 1); assert.equal(h.terminated, 1);
});

test('terminates even when timeout callback throws', () => {
  const h = harness();
  createProviderSessionLiveness({ socket: h.socket, schedule: h.schedule, intervalMs: 10, timeoutMs: 5, onTimeout: () => { throw new Error('callback failed'); } });
  h.advance(10);
  assert.throws(() => h.advance(5), /callback failed/);
  assert.equal(h.terminated, 1);
});

test('terminates even when ping send throws', () => {
  const h = harness(); let timeouts = 0;
  h.throwOnPing = true;
  createProviderSessionLiveness({ socket: h.socket, schedule: h.schedule, intervalMs: 10, timeoutMs: 5, onTimeout: () => timeouts++ });
  h.advance(10);
  assert.equal(timeouts, 1); assert.equal(h.terminated, 1);
});

test('stop cancels timer and unregisters pong handler', () => {
  const h = harness(); let timeouts = 0;
  const life = createProviderSessionLiveness({ socket: h.socket, schedule: h.schedule, intervalMs: 10, timeoutMs: 5, onTimeout: () => timeouts++ });
  life.stop(); h.advance(100); h.pong();
  assert.equal(life.isStopped, true); assert.equal(timeouts, 0); assert.equal(h.terminated, 0);
});
