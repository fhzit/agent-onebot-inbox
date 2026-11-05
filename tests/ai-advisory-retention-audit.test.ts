import test from 'node:test';
import assert from 'node:assert/strict';
import { emitRetentionAuditEvent, type RetentionAuditInput } from '../src/ai-advisory-retention-audit.js';

const base: RetentionAuditInput = {
  eventId: 'evt-1', action: 'preview', actorId: 'operator-1', accountId: 'acct-1',
  cutoff: '2026-01-01T00:00:00Z', retentionDays: 30, policyVersion: 'retention-v2',
  requestedLimit: 50, candidateCount: 3, requestedCount: 0, deletedCount: null,
  outcome: 'success', errorCategory: null, occurredAt: '2026-01-02T00:00:00Z',
};

test('emits an immutable sanitized preview event without content or extra input fields', async () => {
  const events: unknown[] = [];
  const event = await emitRetentionAuditEvent(e => { events.push(e); }, { ...base, message: 'PRIVATE MESSAGE', prompt: 'SECRET PROMPT' } as RetentionAuditInput & Record<string, unknown>);
  assert.equal(events.length, 1);
  assert.deepEqual(event, {
    eventId: 'evt-1', occurredAt: '2026-01-02T00:00:00.000Z', action: 'preview', actorId: 'operator-1',
    accountId: 'acct-1', cutoff: '2026-01-01T00:00:00.000Z', retentionDays: 30, policyVersion: 'retention-v2',
    requestedLimit: 50, candidateCount: 3, requestedCount: 0, deletedCount: null, outcome: 'success', errorCategory: null,
  });
  assert.equal(JSON.stringify(event).includes('PRIVATE MESSAGE'), false);
  assert.equal(JSON.stringify(event).includes('SECRET PROMPT'), false);
  assert.equal(Object.isFrozen(event), true);
});

test('records apply counts and categorized failures; sink failures propagate', async () => {
  const apply = { ...base, action: 'apply' as const, candidateCount: 0, requestedCount: 3, deletedCount: 2, outcome: 'partial' as const };
  const event = await emitRetentionAuditEvent(() => {}, apply);
  assert.equal(event.deletedCount, 2);
  const failed = await emitRetentionAuditEvent(() => {}, { ...apply, outcome: 'failure', errorCategory: 'storage-unavailable' });
  assert.equal(failed.errorCategory, 'storage-unavailable');
  await assert.rejects(() => emitRetentionAuditEvent(() => { throw new Error('sink unavailable'); }, base), /sink unavailable/);
});

test('rejects malformed and inconsistent audit events without calling sink', async () => {
  let calls = 0;
  const sink = () => { calls++; };
  await assert.rejects(() => emitRetentionAuditEvent(sink, { ...base, actorId: ' padded ' }), /actorId/);
  await assert.rejects(() => emitRetentionAuditEvent(sink, { ...base, action: 'apply', requestedCount: 1, deletedCount: 2 }), /deletedCount/);
  await assert.rejects(() => emitRetentionAuditEvent(sink, { ...base, outcome: 'failure' }), /error category/);
  await assert.rejects(() => emitRetentionAuditEvent(sink, { ...base, candidateCount: -1 }), /candidateCount/);
  assert.equal(calls, 0);
});
