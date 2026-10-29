import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAuditMetadata } from '../src/audit-metadata.js';

test('redacts secret keys and omits message content even when nested', () => {
  const result = normalizeAuditMetadata({ provider: 'napcat', access_token: 'token-123', password: 'pw', message: 'private message', content: 'private content', nested: { refreshToken: 'refresh-456', text: 'private text', safe: 'ok' } });
  const serialized = JSON.stringify(result);
  for (const secret of ['token-123', 'pw', 'private message', 'private content', 'refresh-456', 'private text']) assert.equal(serialized.includes(secret), false);
  assert.deepEqual(result, { provider: 'napcat', access_token: '[REDACTED]', password: '[REDACTED]', message: '[REDACTED]', content: '[REDACTED]', nested: { refreshToken: '[REDACTED]', text: '[REDACTED]', safe: 'ok' } });
});

test('bounds depth, entries, strings and output deterministically', () => {
  const input = { z: 'x'.repeat(10000), a: { b: { c: 'deep' } }, list: Array.from({ length: 100 }, (_, i) => i) };
  const first = normalizeAuditMetadata(input);
  assert.deepEqual(normalizeAuditMetadata(input), first);
  assert.ok(JSON.stringify(first).length <= 4096);
  assert.equal((first.z as string).length, 523);
  assert.equal((((first.a as Record<string, unknown>).b as Record<string, unknown>).c), 'deep');
  assert.equal((first.list as unknown[]).length, 50);
});

test('handles cycles and non-JSON values without throwing', () => {
  const cycle: Record<string, unknown> = { okay: 1, date: new Date(0) }; cycle.self = cycle;
  assert.deepEqual(normalizeAuditMetadata(cycle), { okay: 1, date: {}, self: '[CIRCULAR]' });
});
