import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.js';

test('real API routes authenticated attachment retrieval through account-scoped OneBot get_file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aoi-api-attachments-'));
  const allowed = path.join(root, 'allowed'); await mkdir(allowed);
  const file = path.join(allowed, 'download.txt'); await writeFile(file, 'attachment-body');
  let action: unknown;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    action = { url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { file } }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== 'string');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS, oldMax = process.env.ATTACHMENT_MAX_BYTES;
  process.env.ATTACHMENT_ALLOWED_ROOTS = allowed; process.env.ATTACHMENT_MAX_BYTES = '100';
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [
      { id: 'direct', alias: 'Direct', self_id: '100', provider: 'napcat', enabled: true, permission: 'direct', access_token: 'transport-secret', action_url: `http://127.0.0.1:${providerAddress.port}` },
      { id: 'readonly', alias: 'Read only', self_id: '200', provider: 'napcat', enabled: true, permission: 'readonly', access_token: 'transport-secret' },
    ] });
    const address = runtime.address(); assert.ok(address);
    const url = `http://127.0.0.1:${address.port}/api/attachments/direct/provider-file-123`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal(action, undefined);
    const unknown = await fetch(`http://127.0.0.1:${address.port}/api/attachments/missing/file`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(unknown.status, 404);
    const forbidden = await fetch(`http://127.0.0.1:${address.port}/api/attachments/readonly/file`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(forbidden.status, 403);
    const response = await fetch(url, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(response.status, 200); assert.equal(await response.text(), 'attachment-body');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength('attachment-body')));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('content-disposition') ?? '', /filename="download.txt"/);
    assert.deepEqual(action, { url: '/get_file', body: { file_id: 'provider-file-123' } });
  } finally {
    await runtime?.close();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    if (oldRoots === undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS = oldRoots;
    if (oldMax === undefined) delete process.env.ATTACHMENT_MAX_BYTES; else process.env.ATTACHMENT_MAX_BYTES = oldMax;
    await rm(root, { recursive: true, force: true });
  }
});
