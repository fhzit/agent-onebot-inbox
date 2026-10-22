import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

test('invalid inbox filter returns 400 validation error', async () => {
  const port = 24700 + Math.floor(Math.random() * 200);
  const runtime = await startServer({ host:'127.0.0.1', port, apiToken:'api-secret', maxMessageBytes:100000, logMessageContent:false, accounts:[] });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/messages?type=unknown`, { headers:{ authorization:'Bearer api-secret' } });
    assert.equal(response.status, 400);
    const body = await response.json() as { error:{ code:string } };
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  } finally { await runtime.close(); }
});
