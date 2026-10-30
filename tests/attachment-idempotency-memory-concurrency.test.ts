import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';

test('memory-mode attachment idempotency claims the key before async file work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aoi-attachment-memory-race-'));
  const file = path.join(root, 'report.pdf');
  await writeFile(file, 'fixture');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS;
  process.env.ATTACHMENT_ALLOWED_ROOTS = root;
  const port = 29100 + Math.floor(Math.random() * 300);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false,
    accounts: [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' }] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const actions: string[] = [];
    let releaseUpload!: () => void;
    let uploadSeen!: () => void;
    const uploadStarted = new Promise<void>(resolve => { uploadSeen = resolve; });
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
    ws.on('message', raw => {
      const req = JSON.parse(raw.toString()) as { action: string; echo: string };
      actions.push(req.action);
      if (req.action === 'upload_private_file') {
        uploadSeen();
        void uploadGate.then(() => ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { file_id: 'uploaded-42' }, echo: req.echo })));
      } else ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 789 }, echo: req.echo }));
    });
    const payload = { account_id: 'main', client_request_id: 'memory-race-1', target_id: '20002', message_type: 'private', message: '', attachment_path: file };
    const post = () => fetch(`http://127.0.0.1:${port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    try {
      const firstRequest = post();
      await uploadStarted;
      const second = await post();
      const secondBody = await second.json() as { error?: { code?: string } };
      assert.equal(second.status, 409);
      assert.equal(secondBody.error?.code, 'IDEMPOTENCY_IN_PROGRESS');
      releaseUpload();
      const first = await firstRequest;
      const firstBody = await first.json() as { status?: string };
      assert.equal(first.status, 200);
      assert.equal(firstBody.status, 'sent');
    } finally { releaseUpload(); }
    assert.deepEqual(actions, ['upload_private_file', 'send_private_msg']);
  } finally { ws.close(); await runtime.close(); await rm(root, { recursive: true, force: true }); if (oldRoots === undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS = oldRoots; }
});
