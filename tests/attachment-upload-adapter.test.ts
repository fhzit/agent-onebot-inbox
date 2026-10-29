import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AccountConfig } from '../src/config.js';
import { uploadAttachment } from '../src/attachments/upload-adapter.js';

const account = (provider: string): AccountConfig => ({ id: 'acct-1', alias: 'bot', self_id: '42', provider, enabled: true, permission: 'direct' });
async function fixture(run: (root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-upload-'));
  const file = path.join(root, 'report.pdf');
  try { await writeFile(file, 'sample'); await run(root, file); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('NapCat group upload uses documented action and explicit group fields', async () => fixture(async (root, file) => {
  const calls: unknown[][] = [];
  const acc = account('napcat'); const response = { status: 'ok', retcode: 0, data: { file_id: 'f1' } };
  const result = await uploadAttachment({ callApi: async (...args: any[]) => { calls.push(args); return response; } }, acc, { type: 'group', id: '123', folder: '/docs' }, file, [root], 100);
  assert.deepEqual(calls, [[acc, 'upload_group_file', { group_id: '123', file, name: 'report.pdf', folder: '/docs' }]]);
  assert.deepEqual(result, { provider: 'napcat', action: 'upload_group_file', response });
}));

test('SnowLuma private upload uses explicit user_id', async () => fixture(async (root, file) => {
  const calls: unknown[][] = [];
  await uploadAttachment({ callApi: async (...args: any[]) => { calls.push(args); return { status: 'ok', retcode: 0 }; } }, account('snowluma'), { type: 'private', id: '456' }, file, [root], 100);
  assert.equal(calls[0]![1], 'upload_private_file');
  assert.deepEqual(calls[0]![2], { user_id: '456', file, name: 'report.pdf' });
}));

test('rejects unsupported providers, out-of-root paths, oversize files, and provider errors', async () => fixture(async (root, file) => {
  const unused = { callApi: async () => ({ status: 'ok', retcode: 0 }) };
  await assert.rejects(uploadAttachment(unused, account('other'), { type: 'private', id: '1' }, file, [root], 100), /Unsupported/);
  const outsideRoot = path.join(root, 'subroot'); await mkdir(outsideRoot);
  const outside = path.join(root, 'outside'); await writeFile(outside, 'not allowed');
  await assert.rejects(uploadAttachment(unused, account('napcat'), { type: 'private', id: '1' }, outside, [outsideRoot], 100), /File is outside allowed roots/);
  await assert.rejects(uploadAttachment(unused, account('napcat'), { type: 'private', id: '1' }, file, [root], 2), /exceeds configured size/);
  await assert.rejects(uploadAttachment({ callApi: async () => ({ status: 'failed', retcode: 1 }) }, account('snowluma'), { type: 'group', id: '1' }, file, [root], 100), /action failed/);
}));

test('rejects a non-file path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-upload-'));
  try { const dir = path.join(root, 'dir'); await mkdir(dir); await assert.rejects(uploadAttachment({ callApi: async () => ({ status: 'ok', retcode: 0 }) }, account('napcat'), { type: 'private', id: '1' }, dir, [root], 100), /regular file/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
