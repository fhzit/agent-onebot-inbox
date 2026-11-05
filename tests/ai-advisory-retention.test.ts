import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiAdvisoryRetention, previewAiAdvisoryRetention, type AdvisoryIdentity, type AdvisoryMetadata, type AiAdvisoryRetentionRepository } from '../src/ai-advisory-retention.js';

const now = new Date('2026-01-31T00:00:00.000Z');
const expired = (accountId: string, messageId: string, policyVersion = 'v1', createdAt = '2025-12-01T00:00:00.000Z'): AdvisoryMetadata => ({ accountId, messageId, policyVersion, createdAt });

function fakeRepository(rows: AdvisoryMetadata[]) {
  const calls: { list?: { accountId: string; before: string; limit: number }; remove?: { accountId: string; records: AdvisoryIdentity[] } }[] = [];
  const repo: AiAdvisoryRetentionRepository = {
    async listExpired(input) { calls.push({ list: input }); return rows; },
    async deleteAdvisories(input) { calls.push({ remove: input }); return input.records.length; },
  };
  return { repo, calls };
}

test('preview is side-effect free, account fenced, cutoff strict, deduplicated and bounded', async () => {
  const { repo, calls } = fakeRepository([
    expired('acct', 'old'), expired('acct', 'old', 'v2'),
    expired('other', 'foreign'), expired('acct', 'boundary', 'v1', '2026-01-01T00:00:00.000Z'),
    expired('acct', 'new', 'v1', '2026-01-02T00:00:00.000Z'),
    expired('acct', 'old'),
  ]);
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { retentionDays: 30, limit: 1, now });
  assert.equal(preview.cutoff, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(preview.candidates, [{ accountId: 'acct', messageId: 'old', policyVersion: 'v1' }]);
  assert.equal(preview.hasMore, true);
  assert.deepEqual(calls, [{ list: { accountId: 'acct', before: preview.cutoff, limit: 2 } }]);
});

test('apply is explicit, account scoped and deletes metadata identities only', async () => {
  const { repo, calls } = fakeRepository([]);
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now, retentionDays: 30 });
  assert.equal(calls.length, 1);
  const { confirmationToken, ...unsigned } = preview;
  unsigned.candidates = [{ accountId: 'acct', messageId: 'm1', policyVersion: 'v1' }];
  const confirmed = { ...unsigned, confirmationToken, candidates: [{ accountId: 'acct', messageId: 'old', policyVersion: 'v1' }] };
  // The repository preview had no rows, so mint a matching confirmation from eligible metadata below.
  const populated = fakeRepository([expired('acct', 'old')]);
  const validPreview = await previewAiAdvisoryRetention(populated.repo, 'acct', { now, retentionDays: 30 });
  assert.deepEqual(await applyAiAdvisoryRetention(populated.repo, validPreview), { accountId: 'acct', requested: 1, deleted: 1 });
  assert.deepEqual(populated.calls[1].remove, { accountId: 'acct', records: [{ accountId: 'acct', messageId: 'old', policyVersion: 'v1' }] });
  assert.doesNotMatch(JSON.stringify(populated.calls[1].remove), /message text|delete.*messages/i);
});

test('rejects invalid limits, account mismatch and duplicate identities before deletion', async () => {
  const { repo, calls } = fakeRepository([]);
  await assert.rejects(() => previewAiAdvisoryRetention(repo, ' acct ', { now }), /accountId/);
  await assert.rejects(() => previewAiAdvisoryRetention(repo, 'acct', { now, retentionDays: 0 }), /retentionDays/);
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now });
  preview.candidates = [{ accountId: 'other', messageId: 'm', policyVersion: 'v' }];
  await assert.rejects(() => applyAiAdvisoryRetention(repo, preview), /account/);
  preview.candidates = [{ accountId: 'acct', messageId: 'm', policyVersion: 'v' }, { accountId: 'acct', messageId: 'm', policyVersion: 'v' }];
  await assert.rejects(() => applyAiAdvisoryRetention(repo, preview), /duplicate/);
  assert.equal(calls.filter(call => call.remove).length, 0);
});

test('empty preview application is a no-op', async () => {
  const { repo, calls } = fakeRepository([]);
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now });
  assert.deepEqual(await applyAiAdvisoryRetention(repo, preview), { accountId: 'acct', requested: 0, deleted: 0 });
  assert.equal(calls.length, 1);
});

test('confirmation binds scope and exact identities; successful apply cannot replay', async () => {
  const { repo, calls } = fakeRepository([expired('acct', 'safe')]);
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now, retentionDays: 30 });
  await assert.rejects(() => applyAiAdvisoryRetention(repo, { ...preview, candidates: [{ accountId: 'acct', messageId: 'attacker', policyVersion: 'v1' }] }), /does not match/);
  await assert.rejects(() => applyAiAdvisoryRetention(repo, { ...preview, accountId: 'other', candidates: preview.candidates.map(candidate => ({ ...candidate, accountId: 'other' })) }), /does not match/);
  await assert.rejects(() => applyAiAdvisoryRetention(repo, { ...preview, cutoff: '2025-01-01T00:00:00.000Z' }), /does not match/);
  await applyAiAdvisoryRetention(repo, preview);
  await assert.rejects(() => applyAiAdvisoryRetention(repo, preview), /invalid or already used/);
  assert.equal(calls.filter(call => call.remove).length, 1);
});

test('concurrent applications claim a confirmation token only once', async () => {
  let finish!: (count: number) => void;
  let calls = 0;
  const repo: AiAdvisoryRetentionRepository = {
    async listExpired() { return [expired('acct', 'safe')]; },
    async deleteAdvisories(input) { calls++; return new Promise<number>(resolve => { finish = resolve; }); },
  };
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now, retentionDays: 30 });
  const first = applyAiAdvisoryRetention(repo, preview);
  await assert.rejects(() => applyAiAdvisoryRetention(repo, preview), /in progress/);
  assert.equal(calls, 1);
  finish(1);
  assert.deepEqual(await first, { accountId: 'acct', requested: 1, deleted: 1 });
});

test('repository failure leaves confirmation retryable', async () => {
  let calls = 0;
  const repo: AiAdvisoryRetentionRepository = {
    async listExpired() { return [expired('acct', 'safe')]; },
    async deleteAdvisories(input) { calls++; if (calls === 1) throw new Error('temporary failure'); return input.records.length; },
  };
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now, retentionDays: 30 });
  await assert.rejects(() => applyAiAdvisoryRetention(repo, preview), /temporary failure/);
  assert.deepEqual(await applyAiAdvisoryRetention(repo, preview), { accountId: 'acct', requested: 1, deleted: 1 });
  assert.equal(calls, 2);
});

test('expired confirmation cannot be applied', async () => {
  const { repo, calls } = fakeRepository([expired('acct', 'safe')]);
  const preview = await previewAiAdvisoryRetention(repo, 'acct', { now });
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000;
  try { await assert.rejects(() => applyAiAdvisoryRetention(repo, preview), /expired/); }
  finally { Date.now = realNow; }
  assert.equal(calls.filter(call => call.remove).length, 0);
});
