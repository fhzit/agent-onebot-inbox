import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupSha256 } from '../src/backup-manifest-validation.js';
import { previewBackupRestoreJson, runBackupRestorePreviewCli } from '../src/backup-restore-cli.js';
import { runCli } from '../src/cli.js';

test('preview JSON validates entries and emits plan only without extracting files', () => {
  const bytes = Buffer.from('payload');
  const manifest = JSON.stringify({ version: 1, files: [{ path: 'state/data.json', size: bytes.length, sha256: backupSha256(bytes) }] });
  const entries = JSON.stringify({ entries: [{ path: 'state/data.json', data_base64: bytes.toString('base64') }] });
  const output = previewBackupRestoreJson('/restore-root', manifest, entries);
  assert.deepEqual(JSON.parse(output), {
    version: 1,
    files: [{ path: 'state/data.json', destination: join('/restore-root', 'state', 'data.json'), size: 7, sha256: backupSha256(bytes) }],
    totalBytes: 7,
  });
  assert.equal(output.includes('payload'), false);
  assert.throws(() => previewBackupRestoreJson('/restore-root', manifest, JSON.stringify({ entries: [{ path: 'state/data.json', data_base64: '%%%bad' }] })), /base64/);
  assert.throws(() => previewBackupRestoreJson('/restore-root', manifest, JSON.stringify({ entries: [{ path: 'state/data.json', data_base64: Buffer.from('tampered').toString('base64') }] })), /mismatch/);
});

test('operator CLI reads JSON inputs and prints validated preview only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restore-preview-cli-'));
  try {
    const manifestPath = join(dir, 'manifest.json');
    const entriesPath = join(dir, 'entries.json');
    const bytes = Buffer.from('x');
    await writeFile(manifestPath, JSON.stringify({ version: 1, files: [{ path: 'file', size: 1, sha256: backupSha256(bytes) }] }));
    await writeFile(entriesPath, JSON.stringify({ entries: [{ path: 'file', data_base64: bytes.toString('base64') }] }));
    const output: string[] = [];
    await runBackupRestorePreviewCli([join(dir, 'restore'), manifestPath, entriesPath], value => output.push(value));
    assert.deepEqual(JSON.parse(output[0]!).preview, JSON.parse(previewBackupRestoreJson(join(dir, 'restore'), await readFile(manifestPath, 'utf8'), await readFile(entriesPath, 'utf8'))));
    assert.deepEqual(await readdir(dir), ['entries.json', 'manifest.json']);
    const routed: string[] = [];
    await runCli(['backup-restore-preview', join(dir, 'restore'), manifestPath, entriesPath], {}, fetch, value => routed.push(value));
    assert.deepEqual(JSON.parse(routed[0]!), JSON.parse(output[0]!));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('preview CLI rejects incomplete arguments', async () => {
  await assert.rejects(runBackupRestorePreviewCli([]), /Usage:/);
});

test('explicit --apply restores verified files while default remains a dry run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restore-apply-cli-'));
  try {
    const manifestPath = join(dir, 'manifest.json'), entriesPath = join(dir, 'entries.json');
    const bytes = Buffer.from('recovered state');
    await writeFile(manifestPath, JSON.stringify({ version: 1, files: [{ path: 'state/data.json', size: bytes.length, sha256: backupSha256(bytes) }] }));
    await writeFile(entriesPath, JSON.stringify({ entries: [{ path: 'state/data.json', data_base64: bytes.toString('base64') }] }));
    const root = join(dir, 'restore');
    const dry: string[] = [];
    await runBackupRestorePreviewCli([root, manifestPath, entriesPath], value => dry.push(value));
    assert.equal(JSON.parse(dry[0]!).mode, 'dry-run');
    await assert.rejects(readFile(join(root, 'state', 'data.json')));
    const applied: string[] = [];
    await runBackupRestorePreviewCli([root, manifestPath, entriesPath, '--apply'], value => applied.push(value));
    assert.equal(JSON.parse(applied[0]!).mode, 'applied');
    assert.deepEqual(await readFile(join(root, 'state', 'data.json')), bytes);
    await assert.rejects(runBackupRestorePreviewCli([root, manifestPath, entriesPath, '--apply'], () => {}), /already exists/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
