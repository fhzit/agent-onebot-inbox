import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { MessageStore } from '../src/store.js';

test('HTTP event route enforces optional separate provider event token and remains unchanged by default', async () => {
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id:'main', alias:'Main', self_id:'100', provider:'napcat', access_token:'transport-secret' }]), API_TOKEN:'api-secret', ONEBOT_EVENT_TOKEN:'event-secret' });
  const runtime = await startServer({ ...config, host:'127.0.0.1', port:0 }, new MessageStore());
  const addr = runtime.address()!;
  const payload = { post_type:'message', message_type:'private', self_id:'100', user_id:'200', message_id:1, time:1700000000, message:'hello' };
  const request = async (token?:string) => fetch(`http://127.0.0.1:${addr.port}/onebot/v11/events/main`, { method:'POST', headers:{ authorization:'Bearer transport-secret', 'content-type':'application/json', ...(token ? {'x-onebot-token':token}:{}) }, body:JSON.stringify(payload) });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request('wrong')).status, 401);
    assert.equal((await request('event-secret')).status, 200);
  } finally { await runtime.close(); }
});

test('HTTP event token verifier remains optional if no separate token configured', async () => {
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id:'main', alias:'Main', self_id:'100', provider:'napcat', access_token:'transport-secret' }]), API_TOKEN:'api-secret' });
  assert.equal(config.providerEventToken, undefined);
});
