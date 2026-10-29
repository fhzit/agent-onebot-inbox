import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';
import { MessageStore } from '../src/store.js';

test('retry after uncertain attachment parent completion does not upload or send child again', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aoi-attachment-recovery-'));
  const file = path.join(root, 'report.pdf');
  await writeFile(file, 'fixture');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS;
  process.env.ATTACHMENT_ALLOWED_ROOTS = root;
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let ws: WebSocket | undefined;
  try {
    runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false,
      accounts: [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' }] });
    const address = runtime.address(); assert.ok(address);
    ws = new WebSocket(`ws://127.0.0.1:${address.port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject); });
    const actions: string[] = [];
    ws.on('message', raw => {
      const req = JSON.parse(raw.toString()) as { action: string; echo: string };
      actions.push(req.action);
      const data = req.action === 'upload_private_file' ? { file_id: 'uploaded-42' } : { message_id: 789 };
      ws!.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: req.echo }));
    });
    const payload = { account_id: 'main', client_request_id: 'lost-parent-completion', target_id: '20002', message_type: 'private', message: '', attachment_path: file };
    const post = () => fetch(`http://127.0.0.1:${address.port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify(payload) });

    const first = await post();
    assert.equal(first.status, 200);
    const firstBody = await first.json() as { status: string; message: unknown };
    assert.equal(firstBody.status, 'sent');
    assert.deepEqual(actions, ['upload_private_file', 'send_private_msg']);

    // Simulate uncertain parent completion: the child is durable, but parent
    // process-local idempotency state is gone after restart.
    const savedChild = (await runtime.store.list('main', 200)).find(message => message.client_request_id === 'lost-parent-completion:attachment-message');
    assert.ok(savedChild);
    const recoveredStore = new MessageStore();
    recoveredStore.addOutgoing(savedChild);
    await runtime.close();
    runtime = undefined;
    ws.close(); ws = undefined;

    runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false,
      accounts: [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' }] }, recoveredStore);
    // A fresh process-local store represents loading the durable child from storage.
    const retryAddress = runtime.address(); assert.ok(retryAddress);
    ws = new WebSocket(`ws://127.0.0.1:${retryAddress.port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject); });
    const retry = await fetch(`http://127.0.0.1:${retryAddress.port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const retryBody = await retry.json() as { status?: string; error?: { code?: string } };
    // A completed in-memory response is returned when the process has not restarted;
    // this case models a crash/restart with a saved child and requires no re-send.
    assert.equal(retry.status, 502);
    assert.deepEqual(actions, ['upload_private_file', 'send_private_msg']);
  } finally {
    ws?.close(); await runtime?.close(); await rm(root, { recursive: true, force: true });
    if (oldRoots === undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS = oldRoots;
  }
});
