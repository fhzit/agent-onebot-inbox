import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAttachmentRouteHandler } from '../src/attachments/routes.js';

test('serves authenticated attachment by account and provider ID with safe headers', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'aoi-route-'));
  const root = path.join(base, 'allowed'); await mkdir(root);
  await writeFile(path.join(root, 'a.txt'), 'hello');
  let authorizedCalls = 0;
  const handler = createAttachmentRouteHandler({ apiToken: 'secret', allowedRoots: [root], maxBytes: 20,
    resolveAccount: id => id === 'acct' ? { permission: authorizedCalls === 0 ? 'readonly' : 'direct', retrieve: async fid => { authorizedCalls++; assert.equal(fid, 'provider-id'); return path.join(root, 'a.txt'); } } : undefined });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const url = `http://127.0.0.1:${address.port}/api/attachments/acct/provider-id`;
    const denied = await fetch(url); assert.equal(denied.status, 401); assert.equal(authorizedCalls, 0);
    const forbidden = await fetch(url, { headers: { authorization: 'Bearer secret' } }); assert.equal(forbidden.status, 403);
    authorizedCalls = 1;
    const response = await fetch(url, { headers: { authorization: 'Bearer secret' } });
    assert.equal(response.status, 200); assert.equal(await response.text(), 'hello');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="a.txt"/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(base, { recursive: true, force: true }); }
});

test('rejects arbitrary URLs, unknown accounts, and oversized attachments', async () => {
  const handler = createAttachmentRouteHandler({ apiToken: 'secret', allowedRoots: ['/tmp'], maxBytes: 2,
    resolveAccount: id => id === 'url' ? { permission: 'direct', retrieve: async () => 'https://example.com/x' } : id === 'large' ? { permission: 'direct', retrieve: async () => '/tmp/nope' } : undefined });
  const request = async (id: string) => { const server = createServer((req,res)=>{void handler(req,res)}); await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); const a=server.address(); assert.ok(a&&typeof a!=='string'); const response=await fetch(`http://127.0.0.1:${a.port}/api/attachments/${id}/file`,{headers:{authorization:'Bearer secret','x-attachment-direct-permission':'true'}}); await new Promise<void>(r=>server.close(()=>r())); return response.status; };
  assert.equal(await request('missing'),404);
  assert.equal(await request('url'),404);
  assert.equal(await request('large'),404);
});
