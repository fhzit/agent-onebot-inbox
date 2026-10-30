import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
import type { ProviderQualificationRecord } from '../src/provider-qualification-store.js';

test('startServer provider qualification endpoints authenticate and persist exact-version results in memory mode', async () => {
  const runtime = await startServer({
    host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000,
    logMessageContent: false, accounts: [],
  });
  const base = `http://127.0.0.1:${runtime.address()!.port}`;
  const auth = { authorization: 'Bearer api-secret' };
  try {
    const unauthorized = await fetch(`${base}/api/admin/provider-qualification/checklist`);
    assert.equal(unauthorized.status, 401);

    const checklistResponse = await fetch(`${base}/api/admin/provider-qualification/checklist`, { headers: auth });
    assert.equal(checklistResponse.status, 200);
    const checklistBody = await checklistResponse.json() as { checklist: Record<string, { id: string; verification: string }[]> };
    assert.ok(checklistBody.checklist.napcat.some(check => check.id === 'outbound.private-text' && check.verification === 'unverified'));

    const input = {
      provider: ' NapCat ',
      version: '4.2.1',
      checks: [{ id: 'outbound.private-text', status: 'pass', evidence: 'Controlled send observed' }],
    };
    const writeResponse = await fetch(`${base}/api/admin/provider-qualification`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(writeResponse.status, 200);
    const written = (await writeResponse.json() as { record: ProviderQualificationRecord }).record;
    assert.equal(written.provider, 'napcat');
    assert.equal(written.version, '4.2.1');
    assert.equal(written.checks[0]?.providerTested, true);

    const readResponse = await fetch(`${base}/api/admin/provider-qualification/napcat/4.2.1`, { headers: auth });
    assert.equal(readResponse.status, 200);
    assert.deepEqual((await readResponse.json() as { record: ProviderQualificationRecord }).record, written);

    const otherVersion = await fetch(`${base}/api/admin/provider-qualification/napcat/4.2.2`, { headers: auth });
    assert.equal(otherVersion.status, 404);
  } finally {
    await runtime.close();
  }
});
