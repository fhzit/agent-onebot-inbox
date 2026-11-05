import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';

const token = 'ai-advisory-test-token';
const config = () => loadConfig({ API_TOKEN: token, HOST: '127.0.0.1', PORT: '0', ACCOUNTS_JSON: JSON.stringify([{ id: 'acct-ai', alias: 'AI test', self_id: '10001', provider: 'napcat', access_token: 'transport-token', enabled: true, permission: 'readonly' }]) });
const incoming = (id: string) => ({ post_type: 'message', message_type: 'private', self_id: '10001', user_id: '20002', message_id: id, time: 1700000000, message: 'hello there' });

test('AI advisory startup rejects allowlisted accounts that are disabled', async () => {
  const disabled = loadConfig({ API_TOKEN: token, HOST: '127.0.0.1', PORT: '0', ACCOUNTS_JSON: JSON.stringify([{ id: 'acct-ai', alias: 'AI test', self_id: '10001', provider: 'napcat', access_token: 'transport-token', enabled: false, permission: 'readonly' }]) });
  await assert.rejects(() => startServer(disabled, new MessageStore(), undefined, {
    aiAdvisories: { enabled: true, accountIds: ['acct-ai'], model: 'fixture-model', policyVersion: 'test-v1', policy: { enabled: true, labels: ['support'], threshold: 0.5 }, classifier: { async classify() { return { label: 'support', confidence: 0.9 }; } }, store: { async record() { throw new Error('unused'); }, async list() { return []; } } },
  }), /enabled configured accounts/);
});

test('AI advisory API is authenticated, account-fenced and bounded without exposing private text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoi-ai-advisory-'));
  const dbFile = join(dir, 'advisories.json');
  const records = new Map<string, { accountId: string; messageId: string; label: string; confidence: number; model: string; policyVersion: string; createdAt: string }[]>();
  const durableStore = {
    async record(input: { accountId: string; messageId: string; label: string; confidence: number; model: string; policyVersion: string }) {
      const rows = records.get(input.accountId) ?? [];
      const record = { ...input, createdAt: new Date().toISOString() };
      rows.push(record); records.set(input.accountId, rows);
      await writeFile(dbFile, JSON.stringify([...records.values()].flat()));
      return record;
    },
    async list(accountId: string, options: { before?: string; beforeMessageId?: string; limit?: number }) {
      const rows = [...(records.get(accountId) ?? [])].sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.messageId.localeCompare(a.messageId));
      const cursor = options.before ? rows.findIndex(row => row.createdAt < options.before! || (row.createdAt === options.before && row.messageId < options.beforeMessageId!)) : -1;
      return rows.slice(cursor >= 0 ? cursor : 0, (cursor >= 0 ? cursor : 0) + (options.limit ?? 50));
    },
  };
  let calls = 0;
  const classifier = { async classify() { calls++; return { label: 'support', confidence: 0.97, reason: 'not persisted' }; } };
  const consentRows = new Map<string, { enabled: boolean; revision: number }>();
  let consentError = false;
  const consent = { async query(accountId: string) { if (consentError) throw new Error('consent unavailable'); return consentRows.get(accountId) ?? null; } };
  consentRows.set('acct-ai', { enabled: true, revision: 1 });
  const runtime = await startServer(config(), new MessageStore(), undefined, {
    testAiAdvisoryDependencies: true,
    aiAdvisories: { enabled: true, accountIds: ['acct-ai'], model: 'fixture-model', policyVersion: 'test-v1', policy: { enabled: true, labels: ['support'], threshold: 0.5 }, classifier, store: durableStore, consent },
  });
  try {
    const base = `http://127.0.0.1:${runtime.address()!.port}`;
    const unauthorized = await fetch(`${base}/api/ai-advisories?account_id=acct-ai`);
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0);
    const wrongScope = await fetch(`${base}/api/ai-advisories?account_id=other`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(wrongScope.status, 404);
    assert.equal(calls, 0);
    const ingest = await fetch(`${base}/onebot/v11/events/acct-ai`, { method: 'POST', headers: { authorization: 'Bearer transport-token', 'content-type': 'application/json' }, body: JSON.stringify(incoming('m-1')) });
    assert.equal(ingest.status, 200);
    for (let i=0; i<30 && calls===0; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 1);
    consentRows.set('acct-ai', { enabled: false, revision: 2 });
    const revoked = await fetch(`${base}/onebot/v11/events/acct-ai`, { method: 'POST', headers: { authorization: 'Bearer transport-token', 'content-type': 'application/json' }, body: JSON.stringify(incoming('m-2')) });
    assert.equal(revoked.status, 200);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    consentRows.delete('acct-ai');
    const absent = await fetch(`${base}/onebot/v11/events/acct-ai`, { method: 'POST', headers: { authorization: 'Bearer transport-token', 'content-type': 'application/json' }, body: JSON.stringify(incoming('m-3')) });
    assert.equal(absent.status, 200);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    consentError = true;
    const failedConsent = await fetch(`${base}/onebot/v11/events/acct-ai`, { method: 'POST', headers: { authorization: 'Bearer transport-token', 'content-type': 'application/json' }, body: JSON.stringify(incoming('m-4')) });
    assert.equal(failedConsent.status, 200);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    const response = await fetch(`${base}/api/ai-advisories?account_id=acct-ai&limit=10`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json() as { advisories: Record<string, unknown>[] };
    assert.equal(body.advisories.length, 1);
    assert.equal(body.advisories[0]!.label, 'support');
    assert.equal(JSON.stringify(body).includes('hello there'), false);
    assert.equal(JSON.stringify(body).includes('not persisted'), false);
    const badLimit = await fetch(`${base}/api/ai-advisories?account_id=acct-ai&limit=101`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(badLimit.status, 400);
    const invalidCursor = await fetch(`${base}/api/ai-advisories?account_id=acct-ai&before=2024-01-01T00%3A00%3A00.000Z&before_message_id=not-a-uuid`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(invalidCursor.status, 400);
    assert.equal(calls, 1);
  } finally { await runtime.close(); await rm(dir, { recursive: true, force: true }); }
});
