import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryReconciliationService } from '../src/history-reconciliation-service.js';
import type { NormalizedMessage } from '../src/normalize.js';

const message = (id: string) => ({ id, account_id: 'a', conversation_id: 'c', external_message_id: id, event_fingerprint: `fp-${id}` } as NormalizedMessage);

test('service fetches a bounded provider page, plans read-only, and audits outcome', async () => {
  const events: string[] = [];
  let observedCount = 0;
  const service = createHistoryReconciliationService({
    fetchHistory: async (_request, count) => { observedCount = count; events.push('fetch'); return [message('new')]; },
    store: { list: async (_accountId, limit) => { assert.equal(limit, 20); events.push('store'); return [message('local')]; } },
    plan: (local, provider, max) => { events.push('plan'); assert.equal(max, 20); return { existing: [], missing: provider.filter(x => !local.some(y => y.id === x.id)).map(x => ({ accountId: x.account_id, conversationId: x.conversation_id, messageId: x.external_message_id, fingerprint: x.event_fingerprint })), duplicates: [], truncated: false }; },
    audit: { record: async entry => { events.push('audit'); assert.equal(entry.action, 'history.reconcile.dry_run'); assert.equal(entry.result, 'success'); } },
    maxMessages: 20,
  });
  const result = await service({ accountId: 'a', kind: 'group', targetId: 'c', count: 100 });
  assert.equal(observedCount, 20);
  assert.equal(result.plan.missing.length, 1);
  assert.deepEqual(events, ['fetch', 'store', 'plan', 'audit']);
});

test('service audits provider failure and propagates it without touching local store', async () => {
  let storeCalls = 0;
  let auditResult = '';
  const service = createHistoryReconciliationService({
    fetchHistory: async () => { throw new Error('provider unavailable'); },
    store: { list: async () => { storeCalls++; return []; } },
    audit: { record: async entry => { auditResult = entry.result; } },
    maxMessages: 5,
  });
  await assert.rejects(service({ accountId: 'a', kind: 'private', targetId: 'u', count: 1 }), /provider unavailable/);
  assert.equal(storeCalls, 0);
  assert.equal(auditResult, 'failure');
});
