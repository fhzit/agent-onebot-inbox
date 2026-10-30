import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';

test('send API resolves private recipients, refuses missing/ambiguous/mismatch, and preserves explicit targets', async () => {
  const port = 25700 + Math.floor(Math.random() * 200);
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const sentTargets: string[] = [];
    ws.on('message', raw => {
      const frame = JSON.parse(raw.toString()) as { action: string; echo: string; params: { user_id?: string } };
      if (frame.action === 'get_friend_list') {
        runtime.peers.get('main')!.pending.get(frame.echo)!({ status: 'ok', retcode: 0, data: [
          { user_id: '111', nickname: 'Alice' }, { user_id: '222', nickname: 'Alex' }, { user_id: '333', nickname: 'Alex' },
        ] });
      } else if (frame.action === 'send_private_msg') {
        sentTargets.push(String(frame.params.user_id));
        ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: sentTargets.length }, echo: frame.echo }));
      }
    });
    const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
    const sync = fetch(`http://127.0.0.1:${port}/api/admin/accounts/main/contacts/sync-friends`, { method: 'POST', headers });
    assert.equal((await sync).status, 200);
    const post = (id: string, extra: object) => fetch(`http://127.0.0.1:${port}/api/messages/send`, { method: 'POST', headers, body: JSON.stringify({ account_id: 'main', client_request_id: id, message_type: 'private', message: 'hello', ...extra }) });
    const missing = await post('missing-contact', { recipient: 'No such contact' });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: { code: string } }).error.code, 'RECIPIENT_NOT_FOUND');
    const ambiguous = await post('ambiguous-contact', { recipient: 'Alex' });
    assert.equal(ambiguous.status, 409);
    assert.equal((await ambiguous.json() as { error: { code: string } }).error.code, 'AMBIGUOUS_RECIPIENT');
    const mismatch = await post('mismatch-contact', { target_id: '999', recipient: 'Alice' });
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json() as { error: { code: string } }).error.code, 'RECIPIENT_TARGET_MISMATCH');
    const resolved = await post('resolved-contact', { recipient: 'Alice' });
    assert.equal(resolved.status, 200);
    const explicit = await post('explicit-target', { target_id: '909' });
    assert.equal(explicit.status, 200);
    assert.deepEqual(sentTargets, ['111', '909']);
  } finally { ws.close(); await runtime.close(); }
});
