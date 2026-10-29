import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { startServer } from '../src/server.js';

function nextMessage(socket: WebSocket): Promise<any> {
  return new Promise(resolve => socket.once('message', data => resolve(JSON.parse(data.toString()))));
}

test('real API routes authenticated attachment retrieval through account-scoped OneBot get_file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aoi-api-attachments-'));
  const allowed = path.join(root, 'allowed'); await mkdir(allowed);
  const file = path.join(allowed, 'download.txt'); await writeFile(file, 'attachment-body');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS, oldMax = process.env.ATTACHMENT_MAX_BYTES;
  process.env.ATTACHMENT_ALLOWED_ROOTS = allowed; process.env.ATTACHMENT_MAX_BYTES = '100';
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [
      { id: 'direct', alias: 'Direct', self_id: '100', provider: 'napcat', enabled: true, permission: 'direct', access_token: 'transport-secret' },
      { id: 'readonly', alias: 'Read only', self_id: '200', provider: 'napcat', enabled: true, permission: 'readonly', access_token: 'readonly-secret' },
    ] });
    const address = runtime.address(); assert.ok(address);
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/onebot/v11/ws/direct`, { headers: { authorization: 'Bearer transport-secret' } });
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
    const url = `http://127.0.0.1:${address.port}/api/attachments/direct/provider-file-123`;
    assert.equal((await fetch(url)).status, 401);
    const unknown = await fetch(`http://127.0.0.1:${address.port}/api/attachments/missing/file`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(unknown.status, 404);
    const forbidden = await fetch(`http://127.0.0.1:${address.port}/api/attachments/readonly/file`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(forbidden.status, 403);
    const pending = fetch(url, { headers: { authorization: 'Bearer api-secret' } });
    const action = await nextMessage(socket);
    assert.equal(action.action, 'get_file');
    assert.deepEqual(action.params, { file_id: 'provider-file-123' });
    const peer = runtime.peers.get('direct'); assert.ok(peer);
    const resolve = peer.pending.get(action.echo); assert.ok(resolve);
    resolve({ status: 'ok', retcode: 0, data: { file } });
    const response = await pending;
    assert.equal(response.status, 200); assert.equal(await response.text(), 'attachment-body');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength('attachment-body')));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('content-disposition') ?? '', /filename="download.txt"/);
  } finally {
    socket?.close(); await runtime?.close();
    if (oldRoots === undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS = oldRoots;
    if (oldMax === undefined) delete process.env.ATTACHMENT_MAX_BYTES; else process.env.ATTACHMENT_MAX_BYTES = oldMax;
    await rm(root, { recursive: true, force: true });
  }
});
