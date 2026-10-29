import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProviderEventToken } from '../src/provider-event-auth.js';

test('provider event token permits configurations without a token', () => {
  assert.equal(verifyProviderEventToken(undefined, undefined), true);
  assert.equal(verifyProviderEventToken(undefined, 'anything'), true);
  assert.equal(verifyProviderEventToken('', 'anything'), false);
  assert.equal(verifyProviderEventToken('', ''), false);
});

test('provider event token requires exact matching supplied token', () => {
  assert.equal(verifyProviderEventToken('secret', 'secret'), true);
  assert.equal(verifyProviderEventToken('secret', undefined), false);
  assert.equal(verifyProviderEventToken('secret', 'wrong'), false);
  assert.equal(verifyProviderEventToken('secret', 'secret\0'), false);
});
