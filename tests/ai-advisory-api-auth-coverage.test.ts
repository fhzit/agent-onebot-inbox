import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';

const token = 'advisory-auth-test-token';
const accountId = 'acct-advisory';
const config = () => loadConfig({
  API_TOKEN: token,
  HOST: '127.0.0.1',
  PORT: '0',
  ACCOUNTS_JSON: JSON.stringify([{
    id: accountId,
    alias: 'Advisory test account',
    self_id: '10001',
    provider: 'napcat',
    access_token: 'transport-token',
    enabled: true,
    permission: 'readonly',
  }]),
});

test('advisory API authenticates before store access and fences accounts', async () => {
  const calls: string[] = [];
  const store = {
    async record() {
      throw new Error('record is not used by a read request');
    },
    async list(requestedAccountId: string) {
      calls.push(requestedAccountId);
      return [{
        accountId: requestedAccountId,
        messageId: 'message-1',
        label: 'support',
        confidence: 0.95,
        model: 'fixture-model',
        policyVersion: 'test-v1',
        createdAt: '2025-01-01T00:00:00.000Z',
      }];
    },
  };
  const runtime = await startServer(config(), new MessageStore(), undefined, {
    aiAdvisories: {
      enabled: true,
      accountIds: [accountId],
      model: 'fixture-model',
      policyVersion: 'test-v1',
      policy: { enabled: true, labels: ['support'], threshold: 0.5 },
      classifier: { async classify() { return { label: 'support', confidence: 0.95 }; } },
      store,
      consent: { async query() { return { accountId, enabled: true, grantedAt: '2025-01-01T00:00:00.000Z', grantedBy: 'test-principal', disclosureVersion: 'test-v1', revision: 1 }; } },
    },
    testAiAdvisoryDependencies: true,
  });

  try {
    const base = `http://127.0.0.1:${runtime.address()!.port}/api/ai-advisories`;

    const noBearer = await fetch(`${base}?account_id=${accountId}`);
    assert.equal(noBearer.status, 401);
    assert.deepEqual(calls, []);

    const wrongBearer = await fetch(`${base}?account_id=${accountId}`, {
      headers: { authorization: 'Bearer incorrect-token' },
    });
    assert.equal(wrongBearer.status, 401);
    assert.deepEqual(calls, []);

    const unknownAccount = await fetch(`${base}?account_id=acct-unknown`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(unknownAccount.status, 404);
    assert.deepEqual(calls, []);

    const allowedAccount = await fetch(`${base}?account_id=${accountId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(allowedAccount.status, 200);
    assert.deepEqual(calls, [accountId]);
    const body = await allowedAccount.json() as { advisories: { label: string }[] };
    assert.equal(body.advisories.length, 1);
    assert.equal(body.advisories[0]!.label, 'support');
  } finally {
    await runtime.close();
  }
});
