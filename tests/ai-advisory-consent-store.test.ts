import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresAiAdvisoryConsentStore } from '../src/ai-advisory-consent-store.js';
import type { AiAdvisoryConsentState } from '../src/ai-advisory-consent.js';

const row = { account_id: 'acct', enabled: true, actor: 'owner', disclosure_version: 'v1', updated_at: '2026-01-01T00:00:00.000Z', revision: '2' };

test('get scopes lookup to account id with a parameterized query', async () => {
  let call: { text: string; values?: unknown[] } | undefined;
  const store = new PostgresAiAdvisoryConsentStore({ query: async (text, values) => { call = { text, values }; return { rows: [row] }; } });
  const result = await store.get('acct');
  assert.equal(result?.accountId, 'acct');
  assert.deepEqual(call?.values, ['acct']);
  assert.match(call?.text ?? '', /WHERE account_id = \$1/);
});

test('get returns undefined when account has no consent', async () => {
  const store = new PostgresAiAdvisoryConsentStore({ query: async () => ({ rows: [] }) });
  assert.equal(await store.get('acct'), undefined);
});

test('put binds all consent fields and updates only scoped account conflict', async () => {
  let call: { text: string; values?: unknown[] } | undefined;
  const store = new PostgresAiAdvisoryConsentStore({ query: async (text, values) => { call = { text, values }; return { rows: [row] }; } });
  const state: AiAdvisoryConsentState = { accountId: 'acct', enabled: true, grantedAt: '2026-01-01T00:00:00.000Z', grantedBy: 'owner', revision: 2, disclosureVersion: 'v1' };
  await store.put(state);
  assert.deepEqual(call?.values, ['acct', true, 'owner', 'v1', state.grantedAt, 2]);
  assert.match(call?.text ?? '', /ON CONFLICT \(account_id\) DO UPDATE/);
});

test('put rejects if PostgreSQL returns no row', async () => {
  const store = new PostgresAiAdvisoryConsentStore({ query: async () => ({ rows: [] }) });
  await assert.rejects(store.put({ accountId: 'acct', enabled: false, revokedAt: '2026-01-01T00:00:00.000Z', revokedBy: 'owner', revision: 1, disclosureVersion: 'v1' }), /no row/);
});

test('update uses one transaction-bound client for lock, transition write, and commit', async () => {
  const poolCalls: string[] = [];
  const clientCalls: Array<{ text: string; values?: unknown[] }> = [];
  const client = { query: async (text: string, values?: unknown[]) => {
    clientCalls.push({ text, values });
    if (text.includes('SELECT')) return { rows: [row] };
    if (text.includes('INSERT')) return { rows: [{ ...row, enabled: false, actor: 'admin', revision: '3' }] };
    return { rows: [] };
  }, release: () => { poolCalls.push('release'); } };
  const store = new PostgresAiAdvisoryConsentStore({
    query: async text => { poolCalls.push(text); return { rows: [] }; },
    connect: async () => client,
  });
  const result = await store.update('acct', previous => ({
    accountId: 'acct', enabled: false, revokedAt: '2026-01-02T00:00:00.000Z', revokedBy: 'admin', revision: (previous?.revision ?? 0) + 1, disclosureVersion: 'v1',
  }));
  assert.deepEqual(poolCalls, ['release']);
  assert.deepEqual(clientCalls.map(call => call.text.trim().match(/^(BEGIN|SELECT|INSERT|COMMIT)/i)?.[1]?.toUpperCase()), ['BEGIN', 'SELECT', 'INSERT', 'COMMIT']);
  assert.match(clientCalls[1].text, /FOR UPDATE/);
  assert.equal(result.revision, 3);
});

test('update rejects non-transactional Queryable before executing SQL', async () => {
  let called = false;
  const store = new PostgresAiAdvisoryConsentStore({ query: async () => { called = true; return { rows: [] }; } });
  await assert.rejects(store.update('acct', () => ({
    accountId: 'acct', enabled: false, revokedAt: '2026-01-02T00:00:00.000Z', revokedBy: 'admin', revision: 1, disclosureVersion: 'v1',
  })), /transaction-capable/);
  assert.equal(called, false);
});
