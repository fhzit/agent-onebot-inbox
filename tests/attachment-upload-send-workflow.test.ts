import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AccountConfig } from '../src/config.js';
import type { NormalizedMessage, Segment } from '../src/normalize.js';
import type { OneBotGateway } from '../src/onebot-service.js';
import { uploadAndSendAttachment } from '../src/attachments/upload-send-workflow.js';

const account: AccountConfig = { id: 'acct', alias: 'bot', self_id: '42', provider: 'napcat', enabled: true, permission: 'direct' };
async function fixture(run: (root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'upload-send-'));
  const file = path.join(root, 'asset.pdf');
  try { await writeFile(file, 'data'); await run(root, file); } finally { await rm(root, { recursive: true, force: true }); }
}
function stub(uploadResponse: unknown = { status: 'ok', retcode: 0, data: { file_id: 'uploaded:file-1' } }) {
  const calls: string[] = [];
  const message = { external_message_id: 'sent-1' } as NormalizedMessage;
  const gateway = {
    callApi: async () => { calls.push('upload'); return uploadResponse; },
    sendMessage: async (_account: AccountConfig, _type: 'private' | 'group', _target: string, segments: string | Segment[], _requestId: string) => { calls.push(JSON.stringify(segments)); return message; },
  } as unknown as Pick<OneBotGateway, 'callApi' | 'sendMessage'>;
  return { gateway, calls, message };
}

test('uploads then sends only the validated provider file_id to explicit target', async () => fixture(async (root, file) => {
  const s = stub();
  const result = await uploadAndSendAttachment(s.gateway, account, 'direct', { type: 'group', id: 'g1' }, file, [root], 100, 'request-1');
  assert.equal(s.calls[0], 'upload');
  assert.deepEqual(JSON.parse(s.calls[1]!), [{ type: 'file', data: { file: 'uploaded:file-1' } }]);
  assert.equal(result.message, s.message);
}));

test('permission denial makes no provider calls', async () => fixture(async (root, file) => {
  const s = stub();
  await assert.rejects(uploadAndSendAttachment(s.gateway, account, 'read', { type: 'private', id: 'u1' }, file, [root], 100, 'r'), /Direct permission/);
  assert.deepEqual(s.calls, []);
}));

test('invalid upload results fail closed without sending and never retry', async () => fixture(async (root, file) => {
  for (const bad of [null, { status: 'failed', retcode: 1 }, { status: 'ok', retcode: 0, data: {} }]) {
    const s = stub(bad);
    await assert.rejects(uploadAndSendAttachment(s.gateway, account, 'direct', { type: 'private', id: 'u1' }, file, [root], 100, 'r'));
    assert.deepEqual(s.calls, ['upload']);
  }
}));

test('send failure is propagated after one upload, with no retry', async () => fixture(async (root, file) => {
  const calls: string[] = [];
  const gateway = { callApi: async () => { calls.push('upload'); return { status: 'ok', retcode: 0, data: { file_id: 'f' } }; }, sendMessage: async () => { calls.push('send'); throw new Error('send uncertain'); } } as unknown as Pick<OneBotGateway, 'callApi' | 'sendMessage'>;
  await assert.rejects(uploadAndSendAttachment(gateway, account, 'direct', { type: 'private', id: 'u1' }, file, [root], 100, 'r'), /send uncertain/);
  assert.deepEqual(calls, ['upload', 'send']);
}));
