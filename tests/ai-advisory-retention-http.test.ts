import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { startServer } from '../src/server.js';
import type { AiAdvisoryConsentState } from '../src/ai-advisory-consent.js';

const token = 'retention-http-test-token';
const baseConfig = (accounts = [{ id: 'acct-1', alias: 'one', self_id: '1', provider: 'napcat', access_token: 'transport', enabled: true, permission: 'readonly' }]) => loadConfig({
  API_TOKEN: token, HOST: '127.0.0.1', PORT: '0',
  ACCOUNTS_JSON: JSON.stringify(accounts),
});
const retentionPolicy = { version: '1', retentionDays: 30, batchSize: 10 };
const config = () => baseConfig();

async function start(options: { accountIds?: string[]; entries?: { accountId: string; messageId: string; policyVersion: string; createdAt: string }[]; enabled?: boolean } = {}) {
  const entries = options.entries ?? [{ accountId: 'acct-1', messageId: 'old-advisory', policyVersion: 'v1', createdAt: '2020-01-01T00:00:00.000Z' }];
  const deleted: unknown[] = [];
  const calls: string[] = [];
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>(resolve => { releaseDelete = resolve; });
  const store = {
    async listExpired(input: { accountId: string; before: string; limit: number }) {
      calls.push(`list:${input.accountId}`);
      return entries.filter(row => row.accountId === input.accountId && row.createdAt < input.before).slice(0, input.limit);
    },
    async deleteAdvisories(input: { accountId: string; records: unknown[] }) {
      calls.push(`delete:${input.accountId}`); deleted.push(...input.records); return input.records.length;
    },
  };
  const runtime = await startServer(config(), new MessageStore(), undefined, {
    testAiAdvisoryDependencies: true,
    testAiAdvisoryRetentionRepository: store,
    testAiAdvisoryRetentionTransaction: { async transaction(work) { return work({ async deleteAdvisories(input) { calls.push(`delete:${input.accountId}`); deleted.push(...input.records); return input.records.length; } }); } },
    aiAdvisoryRetention: retentionPolicy,
    aiAdvisories: { enabled: true, accountIds: options.accountIds ?? ['acct-1'], model: 'fixture', policyVersion: 'v1', policy: { enabled: true, labels: ['x'], threshold: 0.5 }, classifier: { async classify() { return { label: 'x', confidence: 1 }; } }, store: { async record() { throw new Error('unused'); }, async list() { return []; } }, consent: { async query(): Promise<AiAdvisoryConsentState> { return { accountId: 'acct-1', enabled: true, grantedAt: '2026-01-01T00:00:00.000Z', grantedBy: 'test', disclosureVersion: 'v1', revision: 1 }; } } },
    databaseUrl: 'postgres://unused:unused@127.0.0.1:1/unused',
  });
  const address = runtime.address()!;
  const url = `http://127.0.0.1:${address.port}`;
  async function post(path: string, body: unknown, auth = true) {
    const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
  return { runtime, post, calls, deleted };
}
const previewPath = '/api/admin/ai-advisory-retention/preview';
const applyPath = '/api/admin/ai-advisory-retention/apply';

test('retention HTTP routes authenticate before repository access', async () => {
  const app = await start();
  try {
    assert.equal((await app.post(previewPath, { accountId: 'acct-1' }, false)).status, 401);
    assert.equal((await app.post(applyPath, { accountId: 'acct-1', confirmation_token: 'bad' }, false)).status, 401);
    assert.deepEqual(app.calls, []);
  } finally { await app.runtime.close(); }
});

test('retention HTTP routes require an enabled allowlisted account and strict request/token shapes', async () => {
  const app = await start();
  try {
    assert.equal((await app.post(previewPath, { accountId: 'other' })).status, 404);
    assert.equal((await app.post(previewPath, { accountId: 'acct-1', retentionDays: 1 })).status, 400);
    assert.equal((await app.post(previewPath, '{')).status, 400);
    assert.equal((await app.post(applyPath, { accountId: 'acct-1', confirmation_token: 'invalid' })).body.error.code, 'INVALID_CONFIRMATION');
    assert.deepEqual(app.calls, []);
  } finally { await app.runtime.close(); }
});

test('expired retention confirmation is rejected without deleting advisories', async t => {
  const app = await start();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const preview = await app.post(previewPath, { accountId: 'acct-1' });
    assert.equal(preview.status, 200);
    t.mock.timers.tick(15 * 60 * 1000 + 1);
    const applied = await app.post(applyPath, { accountId: 'acct-1', confirmation_token: preview.body.confirmation_token });
    assert.equal(applied.status, 400);
    assert.equal(applied.body.error.code, 'INVALID_CONFIRMATION');
    assert.deepEqual(app.calls, ['list:acct-1']);
    assert.deepEqual(app.deleted, []);
  } finally { await app.runtime.close(); }
});


test('preview then apply deletes metadata identities only and returns successful audit-free response shape', async () => {
  const app = await start();
  try {
    const preview = await app.post(previewPath, { accountId: 'acct-1' });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.accountId, 'acct-1');
    assert.equal(preview.body.candidates.length, 1);
    assert.equal(typeof preview.body.confirmation_token, 'string');
    assert.equal('confirmationToken' in preview.body, false);
    assert.equal(JSON.stringify(preview.body).includes('private text'), false);
    assert.deepEqual(app.calls, ['list:acct-1']);
    const applied = await app.post(applyPath, { accountId: 'acct-1', confirmation_token: preview.body.confirmation_token });
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.body, { requested: 1, deleted: 1, accountId: 'acct-1' });
    assert.deepEqual(app.calls, ['list:acct-1', 'delete:acct-1']);
    assert.equal(app.deleted.length, 1);
    assert.deepEqual(app.deleted[0], { accountId: 'acct-1', messageId: 'old-advisory', policyVersion: 'v1' });
  } finally { await app.runtime.close(); }
});
