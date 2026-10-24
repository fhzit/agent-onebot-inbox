import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
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
