import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconnectDelayMs } from '../src/provider-reconnect-policy.js';

test('jitter never schedules a retry beyond the configured maximum', () => {
  const options = { baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0.5 };
  assert.equal(reconnectDelayMs(0, options, () => 1), 150);
  assert.equal(reconnectDelayMs(1, options, () => 1), 250);
  assert.equal(reconnectDelayMs(2, options, () => 1), 250);
  assert.equal(reconnectDelayMs(20, options, () => 1), 250);
});
