import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uploadAndSendAttachment } from '../src/attachments/upload-send-workflow.js';
import type { AccountConfig } from '../src/config.js';
import type { OneBotGateway } from '../src/onebot-service.js';

test('attachment digest is computed from the exact snapshot passed to provider upload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aoi-attachment-snapshot-digest-'));
  const file = path.join(root, 'report.pdf');
  await writeFile(file, 'fixture');
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, permission: 'direct' } as AccountConfig;
  let uploadedBytes = '';
  let uploadedPath = '';
  const gateway = {
    callApi: async (_account: AccountConfig, _action: string, params: Record<string, unknown>) => {
      uploadedPath = String(params.file);
      uploadedBytes = await readFile(uploadedPath, 'utf8');
      await writeFile(file, 'changed-after-snapshot');
      return { status: 'ok', retcode: 0, data: { file_id: 'uploaded-snapshot' } };
    },
    sendMessage: async () => ({ id: 'msg-1' }),
  } as unknown as Pick<OneBotGateway, 'callApi' | 'sendMessage'>;
  try {
    const result = await uploadAndSendAttachment(gateway, account, 'direct', { type: 'private', id: '20002' }, file, [root], 100, 'snapshot-test');
    assert.equal(uploadedBytes, 'fixture');
    assert.equal(result.sha256, createHash('sha256').update(uploadedBytes).digest('hex'));
    assert.notEqual(uploadedPath, file);
    await assert.rejects(stat(uploadedPath), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
