import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderConnectionOwner } from '../src/provider-connection-owner.js';

test('coalesces duplicate connect attempts until close', () => {
  const callbacks: Array<(transport: string) => void> = [];
  const owner = createProviderConnectionOwner(() => {});
  assert.equal(owner.connect((opened) => callbacks.push(opened)), true);
  assert.equal(owner.connect((opened) => callbacks.push(opened)), false);
  assert.equal(callbacks.length, 1);
  assert.equal(owner.isConnecting, true);
});

test('fences a late open after close and disposes its transport', () => {
  const callbacks: Array<(transport: string) => void> = [];
  const closed: string[] = [];
  const owner = createProviderConnectionOwner((transport) => closed.push(transport));
  owner.connect((opened) => callbacks.push(opened));
  owner.close();
  callbacks[0]!('stale');
  assert.deepEqual(closed, ['stale']);
  assert.equal(owner.isConnected, false);
  assert.equal(owner.isConnecting, false);
});

test('owns and closes the active transport once, then accepts a new connection', () => {
  const callbacks: Array<(transport: string) => void> = [];
  const closed: string[] = [];
  const owner = createProviderConnectionOwner((transport) => closed.push(transport));
  owner.connect((opened) => callbacks.push(opened));
  callbacks[0]!('first');
  assert.equal(owner.isConnected, true);
  assert.equal(owner.connect((opened) => callbacks.push(opened)), false);
  owner.close();
  owner.close();
  assert.deepEqual(closed, ['first']);
  assert.equal(owner.connect((opened) => callbacks.push(opened)), true);
  callbacks[1]!('second');
  assert.equal(owner.isConnected, true);
});

test('synchronously opened connection is not left connecting', () => {
  const owner = createProviderConnectionOwner(() => {});
  assert.equal(owner.connect((opened) => opened('sync')), true);
  assert.equal(owner.isConnecting, false);
  assert.equal(owner.isConnected, true);
});

test('failed synchronous start permits retry', () => {
  const owner = createProviderConnectionOwner(() => {});
  assert.throws(() => owner.connect(() => { throw new Error('connect failed'); }), /connect failed/);
  assert.equal(owner.isConnecting, false);
  assert.equal(owner.connect(() => {}), true);
});
