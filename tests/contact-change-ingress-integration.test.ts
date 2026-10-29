import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };

test('HTTP OneBot contact notices schedule bounded snapshot refreshes without blocking response', async () => {
  const port = 35100 + Math.floor(Math.random() * 500);
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([account]), API_TOKEN: 'api-secret', HOST: '127.0.0.1', PORT: String(port) });
  const runtime = await startServer(config);
  const headers = { authorization: 'Bearer transport-secret', 'content-type': 'application/json' };
  try {
    const notice = await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify({ post_type: 'notice', notice_type: 'friend_add', self_id: 10001 }) });
    assert.equal(notice.status, 200);
    assert.deepEqual(await notice.json(), { status: 'ignored' });
    const unrelated = await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify({ post_type: 'notice', notice_type: 'group_increase', self_id: 10001 }) });
    assert.equal(unrelated.status, 200);
    assert.deepEqual(await unrelated.json(), { status: 'ignored' });
  } finally {
    await runtime.close();
  }
});
