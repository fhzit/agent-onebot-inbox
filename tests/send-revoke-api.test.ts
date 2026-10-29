import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';

test('authenticated API sends and revokes successfully', async () => {
  const port = 23800 + Math.floor(Math.random() * 400);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.on('message', raw => {
      const req = JSON.parse(raw.toString()) as { action: string; echo: string };
      const data = req.action === 'send_private_msg' ? { message_id: 778 } : {};
      ws.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: req.echo }));
    });
    const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
    const send = await fetch(`http://127.0.0.1:${port}/api/messages/send`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', client_request_id: 'send-success-test', target_id: '20002', message_type: 'private', message: 'hello' }) });
    assert.equal(send.status, 200);
    const sent = await send.json() as { status: string; message: { external_message_id: string } };
    assert.equal(sent.status, 'sent');
    assert.equal(sent.message.external_message_id, '778');
    const revoke = await fetch(`http://127.0.0.1:${port}/api/messages/revoke`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', message_id: sent.message.external_message_id }) });
    assert.equal(revoke.status, 200);
    const revoked = await revoke.json() as { status: string; action: string; provider_response: { status: string; retcode: number } };
    assert.equal(revoked.status, 'success');
    assert.equal(revoked.action, 'delete_msg');
    assert.equal(revoked.provider_response.status, 'ok');
    assert.equal(revoked.provider_response.retcode, 0);
  } finally { ws.close(); await runtime.close(); }
});

test('send resolves unique contact by name only within explicit account and refuses ambiguity', async () => {
  const port = 25210 + Math.floor(Math.random() * 100);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const actions: unknown[] = [];
    ws.on('message', raw => { const req = JSON.parse(raw.toString()) as { action: string; params: unknown; echo: string }; actions.push(req); ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 778 }, echo: req.echo })); });
    const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
    const syncResult = fetch(`http://127.0.0.1:${port}/api/admin/accounts/main/contacts/sync-friends`, { method: 'POST', headers });
    const syncAction = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for friend list')), 3000);
      const onMessage = (raw: Buffer) => { const req = JSON.parse(raw.toString()) as {action:string;echo:string}; if (req.action !== 'get_friend_list') return; ws.off('message', onMessage); runtime.peers.get('main')!.pending.get(req.echo)!({ status:'ok', retcode:0, data:[{user_id:'111',nickname:'Alice One'},{user_id:'222',nickname:'Alex'},{user_id:'333',nickname:'Alex'}] }); clearTimeout(timer); resolve(); };
      ws.on('message', onMessage);
    });
    await syncAction;
    assert.equal((await syncResult).status, 200);
    const base = `http://127.0.0.1:${port}/api/messages/send`;
    const send = (id: string, target: string, accountId = 'main') => fetch(base, { method: 'POST', headers, body: JSON.stringify({ account_id: accountId, client_request_id: id, recipient: target, message_type: 'private', message: 'hello' }) });
    const resolved = await send('named-contact', 'Alice One');
    assert.equal(resolved.status, 200);
    const sentAction = actions.find(x => (x as {action:string}).action === 'send_private_msg') as {params:{user_id:string}};
    assert.equal(sentAction.params.user_id, '111');
    const ambiguous = await send('ambiguous-contact', 'Alex');
    assert.equal(ambiguous.status, 409);
    assert.equal((await ambiguous.json() as {error:{code:string}}).error.code, 'AMBIGUOUS_RECIPIENT');
    assert.equal(actions.filter(x => (x as {action:string}).action === 'send_private_msg').length, 1);
    const wrongAccount = await send('wrong-account', 'Alice One', 'other');
    assert.equal(wrongAccount.status, 404);
  } finally { ws.close(); await runtime.close(); }
});

test('revoke requires authentication', async () => {
  const port = 24810 + Math.floor(Math.random() * 100);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/messages/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: 'main', message_id: 778 }) });
    assert.equal(response.status, 401);
  } finally { await runtime.close(); }
});

test('revoke rejects unknown and incoming message IDs', async () => {
  const port = 24810 + Math.floor(Math.random() * 100);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
    for (const message_id of [778, 'incoming-id']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/messages/revoke`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', message_id }) });
      assert.equal(response.status, message_id === 778 ? 404 : 400);
    }
  } finally { await runtime.close(); }
});

test('revoke rejects malformed and out-of-range int32 IDs', async () => {
  const port = 24810 + Math.floor(Math.random() * 100);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
    await new Promise(resolve => setTimeout(resolve, 30));
    for (const message_id of [1.5, '1e2', 2147483648, -2147483649]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/messages/revoke`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', message_id }) });
      assert.equal(response.status, 400);
    }
  } finally { await runtime.close(); }
});

test('revoke reports provider failure instead of success', async () => {
  const port = 24300 + Math.floor(Math.random() * 500);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.on('message', raw => { const req = JSON.parse(raw.toString()) as { action: string; echo: string }; ws.send(JSON.stringify({ status: req.action === 'delete_msg' ? 'failed' : 'ok', retcode: req.action === 'delete_msg' ? 100 : 0, data: req.action === 'delete_msg' ? null : { message_id: 778 }, message: 'fixture failure', echo: req.echo })); });
    const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
    const send = await fetch(`http://127.0.0.1:${port}/api/messages/send`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', client_request_id: 'send-fail-test', target_id: '20002', message_type: 'private', message: 'hello' }) });
    const sent = await send.json() as { message: { external_message_id: string } };
    const revoke = await fetch(`http://127.0.0.1:${port}/api/messages/revoke`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', message_id: sent.message.external_message_id }) });
    assert.equal(revoke.status, 502); assert.equal((await revoke.json() as { status: string }).status, 'failed');
  } finally { ws.close(); await runtime.close(); }
});
