import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';

const accounts = [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat' as const, enabled: true, access_token: 'transport-secret', permission: 'direct' as const }];

test('attachment idempotency distinguishes changed file metadata and target, and reserves child IDs for attachments', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aoi-attachment-boundary-'));
  const file = path.join(root, 'report.pdf');
  const renamed = path.join(root, 'renamed.pdf');
  await writeFile(file, 'fixture');
  await writeFile(renamed, 'fixture');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS;
  process.env.ATTACHMENT_ALLOWED_ROOTS = root;
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let ws: WebSocket | undefined;
  try {
    runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts });
    const address = runtime.address(); assert.ok(address);
    ws = await connect(address.port);
    const actions = serve(ws);
    const base = { account_id: 'main', client_request_id: 'boundary-key', target_id: '20002', message_type: 'private', message: '' };
    const post = (payload: object) => fetch(`http://127.0.0.1:${address.port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify(payload) });

    const initial = await post({ ...base, attachment_path: file });
    assert.equal(initial.status, 200);
    assert.equal((await initial.json() as { status: string }).status, 'sent');
    for (const changed of [
      { ...base, attachment_path: renamed },
      { ...base, target_id: '20003', attachment_path: file },
    ]) {
      const response = await post(changed);
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error?: { code?: string } }).error?.code, 'IDEMPOTENCY_CONFLICT');
    }
    const plainChild = await post({ ...base, client_request_id: 'boundary-key:attachment-message', attachment_path: undefined, message: 'ordinary text' });
    assert.equal(plainChild.status, 400);
    assert.equal((await plainChild.json() as { error?: { code?: string } }).error?.code, 'VALIDATION_ERROR');
    assert.deepEqual(actions, ['upload_private_file', 'send_private_msg']);
  } finally {
    ws?.close(); await runtime?.close(); await rm(root, { recursive: true, force: true });
    if (oldRoots === undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS = oldRoots;
  }
});

test('process-local attachment idempotency cache resets on server restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aoi-attachment-restart-'));
  const file = path.join(root, 'report.pdf');
  await writeFile(file, 'fixture');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS;
  process.env.ATTACHMENT_ALLOWED_ROOTS = root;
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let ws: WebSocket | undefined;
  const actions: string[] = [];
  const payload = { account_id: 'main', client_request_id: 'restart-key', target_id: '20002', message_type: 'private', message: '', attachment_path: file };
  try {
    for (let run = 0; run < 2; run++) {
      runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts });
      const address = runtime.address(); assert.ok(address);
      ws = await connect(address.port);
      ws.on('message', raw => {
        const req = JSON.parse(raw.toString()) as { action: string; echo: string };
        actions.push(req.action);
        const data = req.action === 'upload_private_file' ? { file_id: `uploaded-${run}` } : { message_id: 789 + run };
        ws!.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: req.echo }));
      });
      const response = await fetch(`http://127.0.0.1:${address.port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(response.status, 200);
      assert.equal((await response.json() as { status: string }).status, 'sent');
      ws.close(); ws = undefined;
      await runtime.close(); runtime = undefined;
    }
    assert.deepEqual(actions, ['upload_private_file', 'send_private_msg', 'upload_private_file', 'send_private_msg']);
  } finally {
    ws?.close(); await runtime?.close(); await rm(root, { recursive: true, force: true });
    if (oldRoots === undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS = oldRoots;
  }
});

async function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
function serve(ws: WebSocket): string[] {
  const actions: string[] = [];
  ws.on('message', raw => {
    const req = JSON.parse(raw.toString()) as { action: string; echo: string };
    actions.push(req.action);
    const data = req.action === 'upload_private_file' ? { file_id: 'uploaded-42' } : { message_id: 789 };
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: req.echo }));
  });
  return actions;
}
