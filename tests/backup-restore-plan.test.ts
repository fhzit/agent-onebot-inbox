import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupSha256 } from '../src/backup-manifest-validation.js';
import { buildBackupRestorePlan } from '../src/backup-restore-plan.js';

const makeEntry = (path: string, text: string) => ({ path, data: Buffer.from(text) });
const record = (entry: ReturnType<typeof makeEntry>) => ({ path: entry.path, size: entry.data.length, sha256: backupSha256(entry.data) });

test('builds a stable ordered, checksum-verified plan without filesystem writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'restore-plan-'));
  try {
    const b = makeEntry('z/file.txt', 'last'), a = makeEntry('a/file.txt', 'first');
    const manifest = { version: 1, files: [record(b), record(a)] };
    const plan = buildBackupRestorePlan(root, manifest, [b, a]);
    assert.deepEqual(plan.map(item => item.path), ['a/file.txt', 'z/file.txt']);
    assert.equal(plan[0]!.destination, join(root, 'a', 'file.txt'));
    assert.equal(plan[0]!.sha256, backupSha256(a.data));
    assert.deepEqual(plan[0]!.data, a.data);
    assert.equal((await stat(root)).isDirectory(), true);
    assert.deepEqual(await (await import('node:fs/promises')).readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects checksum/manifest tampering and unsafe paths before returning a plan', () => {
  const entry = makeEntry('safe.txt', 'payload');
  const good = { version: 1, files: [record(entry)] };
  assert.throws(() => buildBackupRestorePlan('/restore', good, [{ ...entry, data: Buffer.from('tampered') }]), /size mismatch|checksum mismatch/);
  for (const path of ['../escape', '/absolute', 'C:/drive', 'a\\b']) {
    const bad = makeEntry(path, 'x');
    assert.throws(() => buildBackupRestorePlan('/restore', { version: 1, files: [record(bad)] }, [bad]), /path/);
  }
});

test('rejects mismatched archive inventories and duplicate paths', () => {
  const entry = makeEntry('one.txt', '1');
  assert.throws(() => buildBackupRestorePlan('/restore', { version: 2, files: [] }, []), /version/);
  assert.throws(() => buildBackupRestorePlan('/restore', { version: 1, files: [record(entry)] }, []), /missing archive entries/);
  assert.throws(() => buildBackupRestorePlan('/restore', { version: 1, files: [record(entry)] }, [entry, entry]), /Duplicate/);
});
