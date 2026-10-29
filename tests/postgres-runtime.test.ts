import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
import { PostgresAccountStore } from '../src/account-store.js';
import { productionRequiresDatabase } from '../src/startup-policy.js';

 test('production startup policy requires durable database', () => {
  assert.equal(productionRequiresDatabase('production'), true);
  assert.equal(productionRequiresDatabase('development'), false);
  assert.equal(productionRequiresDatabase(undefined), false);
});

test('production runtime requires DATABASE_URL before starting server', async () => {
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'readonly' as const };
  await assert.rejects(startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] }, undefined, { rules: [], watchPeople: [] }, { requireDatabase: true }), /DATABASE_URL/);
});


test('startup rejects persisted database-managed action_url hosts outside the allowlist', async () => {
  const original = process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS;
  process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS = 'approved.example';
  const account = { id: 'managed', alias: 'Managed', self_id: '2', provider: 'napcat', enabled: true, permission: 'readonly' as const, action_url: 'http://127.0.0.1:9000' };
  const accountStore = { loadConfiguredAccounts: async () => [account], create: async () => {} };
  try {
    await assert.rejects(startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [] }, undefined, { rules: [], watchPeople: [] }, { databaseUrl: 'postgres://unused', accountEncryptionKey: Buffer.alloc(32, 1).toString('base64'), accountStore }), /ATTACHMENT_ACTION_URL_ALLOWED_HOSTS/);
  } finally {
    if (original === undefined) delete process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS; else process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS = original;
  }
});
