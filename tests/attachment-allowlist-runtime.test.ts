import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

test('runtime-created accounts cannot retrieve attachments from a non-allowlisted action host', async () => {
  const oldHosts = process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS;
  delete process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS;
  const runtime = await startServer({ host:'127.0.0.1', port:0, apiToken:'api-secret', maxMessageBytes:100000, logMessageContent:false, accounts:[] });
  try {
    const address = runtime.address(); assert.ok(address);
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization:'Bearer api-secret', 'content-type':'application/json' };
    const created = await fetch(`${base}/api/admin/accounts`, { method:'POST', headers, body:JSON.stringify({id:'dynamic',alias:'Dynamic',self_id:'100',provider:'napcat',access_token:'transport',permission:'direct',action_url:'http://127.0.0.1:9'}) });
    assert.equal(created.status, 400);
    const error = await created.json() as {error:{code:string}};
    assert.equal(error.error.code, 'VALIDATION_ERROR');
    assert.equal((await fetch(`${base}/api/admin/accounts`, {headers})).status, 200);
  } finally {
    await runtime.close();
    if (oldHosts === undefined) delete process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS; else process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS = oldHosts;
  }
});
