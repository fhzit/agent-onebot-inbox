import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('HTTP contact notices coalesce active same-key changes into a rerun', async () => {
  const actions: string[] = [];
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let peer: WebSocket | undefined;
  try {
    // The reverse-WebSocket action peer avoids localhost HTTP and leaves SSRF policy unchanged.
    runtime = await startServer(loadConfig({ ACCOUNTS_JSON: JSON.stringify([account]), API_TOKEN: 'api-secret', HOST: '127.0.0.1', PORT: '0' }));
    const address = runtime.address();
    assert.ok(address);
    peer = new WebSocket(`ws://127.0.0.1:${address.port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret' } });
    await once(peer, 'open');
    peer.on('message', async raw => {
      const request = JSON.parse(raw.toString()) as { action: string; echo: string };
      actions.push(request.action);
      if (actions.length === 1) { firstStarted(); await firstGate; }
      peer?.send(JSON.stringify({ status: 'ok', retcode: 0, data: [], echo: request.echo }));
    });

    const headers = { authorization: 'Bearer transport-secret', 'content-type': 'application/json' };
    const sendNotice = () => fetch(`http://127.0.0.1:${address.port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify({ post_type: 'notice', notice_type: 'friend_add', self_id: 10001 }) });
    const firstResponse = await sendNotice();
    assert.deepEqual(await firstResponse.json(), { status: 'ignored' });
    await started;
    const secondResponse = await sendNotice();
    assert.deepEqual(await secondResponse.json(), { status: 'ignored' });
    assert.equal(actions.length, 1);
    releaseFirst();
    await waitFor(() => actions.length === 2, 'coalesced contact refresh rerun');
    assert.deepEqual(actions, ['get_friend_list', 'get_friend_list']);
  } finally {
    releaseFirst();
    if (peer && peer.readyState !== WebSocket.CLOSED) {
      peer.close();
      await Promise.race([once(peer, 'close'), new Promise(resolve => setTimeout(resolve, 1000))]);
      peer.terminate();
    }
    if (runtime) await runtime.close();
  }
});

test('group membership notice refreshes groups before that group members', async () => {
  const actions: string[] = [];
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let peer: WebSocket | undefined;
  try {
    runtime = await startServer(loadConfig({ ACCOUNTS_JSON: JSON.stringify([account]), API_TOKEN: 'api-secret', HOST: '127.0.0.1', PORT: '0' }));
    const address = runtime.address();
    assert.ok(address);
    peer = new WebSocket(`ws://127.0.0.1:${address.port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret' } });
    await once(peer, 'open');
    peer.on('message', raw => {
      const request = JSON.parse(raw.toString()) as { action: string; echo: string; params?: { group_id?: string } };
      actions.push(request.action);
      peer?.send(JSON.stringify({ status: 'ok', retcode: 0, data: request.action === 'get_group_list' ? [{ group_id: 123, group_name: 'Group' }] : [], echo: request.echo }));
    });

    const response = await fetch(`http://127.0.0.1:${address.port}/onebot/v11/events/main`, {
      method: 'POST',
      headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ post_type: 'notice', notice_type: 'group_increase', self_id: 10001, group_id: 123, user_id: 456 }),
    });
    assert.deepEqual(await response.json(), { status: 'ignored' });
    await waitFor(() => actions.length === 2, 'group and member refreshes');
    assert.deepEqual(actions, ['get_group_list', 'get_group_member_list']);
  } finally {
    if (peer && peer.readyState !== WebSocket.CLOSED) {
      peer.close();
      await Promise.race([once(peer, 'close'), new Promise(resolve => setTimeout(resolve, 1000))]);
      peer.terminate();
    }
    if (runtime) await runtime.close();
  }
});

test('unrelated contact notices remain ignored', async () => {
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer(loadConfig({ ACCOUNTS_JSON: JSON.stringify([account]), API_TOKEN: 'api-secret', HOST: '127.0.0.1', PORT: '0' }));
    const address = runtime.address();
    assert.ok(address);
    const headers = { authorization: 'Bearer transport-secret', 'content-type': 'application/json' };
    const unrelated = await fetch(`http://127.0.0.1:${address.port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify({ post_type: 'notice', notice_type: 'group_admin', self_id: 10001 }) });
    assert.equal(unrelated.status, 200);
    assert.deepEqual(await unrelated.json(), { status: 'ignored' });
  } finally {
    if (runtime) await runtime.close();
  }
});
