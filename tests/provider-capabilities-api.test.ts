import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };

test('provider capability API is authenticated and labels registry data as unverified declarations', async () => {
  const port = 31000 + Math.floor(Math.random() * 500);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/admin/provider-capabilities`);
    assert.equal(denied.status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/provider-capabilities`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(response.status, 200);
    const body = await response.json() as { verification: string; capabilities: Array<{ provider: string; declared: boolean; verified: boolean; actions: string[] }> };
    assert.equal(body.verification, 'declarations_only');
    assert.deepEqual(body.capabilities.map(item => item.provider), ['napcat']);
    assert.ok(body.capabilities.every(item => item.declared && item.verified === false));
    assert.ok(body.capabilities.find(item => item.provider === 'napcat')!.actions.includes('get_file'));
    assert.doesNotMatch(JSON.stringify(body), /transport-secret/);
  } finally { await runtime.close(); }
});
