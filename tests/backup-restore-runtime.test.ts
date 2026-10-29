import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupSha256 } from '../src/backup-manifest-validation.js';
import { previewBackupRestore } from '../src/backup-restore-runtime.js';

const archiveFile = (path: string, text: string) => ({ path, data: Buffer.from(text) });
const manifestFile = (entry: ReturnType<typeof archiveFile>) => ({
  path: entry.path,
  size: entry.data.byteLength,
  sha256: backupSha256(entry.data),
});

test('returns a sorted, payload-free operator preview and makes no filesystem changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'restore-runtime-'));
  try {
    const later = archiveFile('z/last.txt', 'last');
    const earlier = archiveFile('a/first.txt', 'first');
    const preview = previewBackupRestore(root, { version: 1, files: [manifestFile(later), manifestFile(earlier)] }, [later, earlier]);

    assert.deepEqual(preview, {
      version: 1,
      files: [
        { path: 'a/first.txt', destination: join(root, 'a', 'first.txt'), size: 5, sha256: backupSha256(earlier.data) },
        { path: 'z/last.txt', destination: join(root, 'z', 'last.txt'), size: 4, sha256: backupSha256(later.data) },
      ],
      totalBytes: 9,
    });
    assert.equal('data' in preview.files[0]!, false);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid manifests, inventory, checksums, and unsafe paths without returning a partial preview', () => {
  const entry = archiveFile('safe.txt', 'payload');
  const manifest = { version: 1, files: [manifestFile(entry)] };

  assert.throws(() => previewBackupRestore('/restore', { version: 2, files: [] }, []), /version/);
  assert.throws(() => previewBackupRestore('/restore', manifest, []), /missing archive entries/);
  assert.throws(() => previewBackupRestore('/restore', manifest, [{ ...entry, data: Buffer.from('tampered') }]), /size mismatch|checksum mismatch/);
  const unsafe = archiveFile('../escape', 'x');
  assert.throws(() => previewBackupRestore('/restore', { version: 1, files: [manifestFile(unsafe)] }, [unsafe]), /path/);
});
