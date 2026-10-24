import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startServer } from '../src/server.js';

const token = 'contact-search-api-secret';
const accounts = [
  { id: 'one', alias: 'One', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'one-transport', permission: 'readonly' as const },
  { id: 'two', alias: 'Two', self_id: '10002', provider: 'napcat', enabled: true, access_token: 'two-transport', permission: 'readonly' as const },
];

function listen(ws: WebSocket, action: string, responseData: unknown) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${action}`)), 3000);
    ws.once('message', data => {
      const frame = JSON.parse(data.toString());
      try {
        assert.equal(frame.action, action);
        const peer = runtime!.peers.get(frame.account_id ?? 'one');
        const matching = [...runtime!.peers.values()].find(candidate => candidate.pending.has(frame.echo));
        assert.ok(matching, 'pending OneBot request exists');
        matching!.pending.get(frame.echo)!({ status: 'ok', retcode: 0, data: responseData });
        clearTimeout(timeout);
        resolve();
      } catch (error) { clearTimeout(timeout); reject(error); }
    });
  });
}
let runtime: Awaited<ReturnType<typeof startServer>> | undefined;

test('contact search requires admin authentication and scopes results to requested account', async () => {
  const port = 32000 + Math.floor(Math.random() * 500);
  runtime = await startServer({ host: '127.0.0.1', port, apiToken: token, maxMessageBytes: 100000, logMessageContent: false, accounts });
  const sockets = accounts.map(account => new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/${account.id}`, { headers: { authorization: `Bearer ${account.access_token}` } }));
  try {
    await Promise.all(sockets.map(ws => new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); })));
    const searchUrl = `http://127.0.0.1:${port}/api/admin/accounts/one/contacts/search?q=Alice%20One`;
    assert.equal((await fetch(searchUrl)).status, 401);
    const wrong = await fetch(searchUrl, { headers: { authorization: 'Bearer wrong' } });
    assert.equal(wrong.status, 401);

    const syncFriends = async (ws: WebSocket, accountId: string, rows: unknown[]) => {
      const request = fetch(`http://127.0.0.1:${port}/api/admin/accounts/${accountId}/contacts/sync-friends`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for get_friend_list')), 3000);
        ws.once('message', data => {
          try {
            const frame = JSON.parse(data.toString());
            assert.equal(frame.action, 'get_friend_list');
            const peer = runtime!.peers.get(accountId)!;
            assert.ok(peer.pending.has(frame.echo));
            peer.pending.get(frame.echo)!({ status: 'ok', retcode: 0, data: rows });
            clearTimeout(timer); resolve();
          } catch (error) { clearTimeout(timer); reject(error); }
        });
      });
      assert.equal((await request).status, 200);
    };
    await syncFriends(sockets[0]!, 'one', [{ user_id: '111', nickname: 'Alice One' }, { user_id: '222', nickname: 'Alex Alice' }]);
    await syncFriends(sockets[1]!, 'two', [{ user_id: '333', nickname: 'Alice Two' }]);
    const response = await fetch(searchUrl, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.ok(result.results.length > 0);
    assert.ok(result.results.every((contact: any) => contact.account_id === 'one'));
    assert.ok(result.results.every((contact: any) => contact.qq_id !== '333'));
  } finally {
    sockets.forEach(ws => ws.close());
    await runtime.close();
    runtime = undefined;
  }
});

test('contact search validates query length and limit, and reports ambiguous matches', async () => {
  const port = 32500 + Math.floor(Math.random() * 400);
  runtime = await startServer({ host: '127.0.0.1', port, apiToken: token, maxMessageBytes: 100000, logMessageContent: false, accounts: [accounts[0]!] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/one`, { headers: { authorization: 'Bearer one-transport' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const sync = fetch(`http://127.0.0.1:${port}/api/admin/accounts/one/contacts/sync-friends`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for get_friend_list')), 3000);
      ws.once('message', data => {
        try {
          const frame = JSON.parse(data.toString());
          assert.equal(frame.action, 'get_friend_list');
          const peer = runtime!.peers.get('one')!;
          peer.pending.get(frame.echo)!({ status: 'ok', retcode: 0, data: [{ user_id: '111', nickname: 'Alex' }, { user_id: '222', nickname: 'Alex' }] });
          clearTimeout(timer); resolve();
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
    assert.equal((await sync).status, 200);
    const base = `http://127.0.0.1:${port}/api/admin/accounts/one/contacts/search`;
    const headers = { authorization: `Bearer ${token}` };
    for (const url of [`${base}?q=${'x'.repeat(201)}`, `${base}?q=Alex&limit=0`, `${base}?q=Alex&limit=101`, `${base}?q=Alex&limit=nope`]) {
      const response = await fetch(url, { headers });
      assert.equal(response.status, 400, url);
      assert.equal((await response.json() as any).error.code, 'VALIDATION_ERROR');
    }
    const response = await fetch(`${base}?q=Alex`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.results.length, 2);
  } finally {
    ws.close();
    await runtime.close();
    runtime = undefined;
  }
});
