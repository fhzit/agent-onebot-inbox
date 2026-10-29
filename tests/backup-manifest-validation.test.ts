import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupSha256, validateBackupImportManifest } from '../src/backup-manifest-validation.js';

const content = Buffer.from('bounded import payload');
const digest = backupSha256(content);
const file = { path: 'data/messages.json', size: content.length, sha256: digest };
const manifest = { version: 1, files: [file] };

test('accepts matching manifest entries without writing or extracting data', () => {
  assert.deepEqual(validateBackupImportManifest(manifest, [file]), manifest);
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test('rejects invalid version and malformed checksums', () => {
  assert.throws(() => validateBackupImportManifest({ ...manifest, version: 2 }, [file]), /version/);
  assert.throws(() => validateBackupImportManifest({ version: 1, files: [{ ...file, sha256: 'xyz' }] }, []), /checksum/);
});

test('rejects traversal, absolute, platform-specific, and duplicate paths', () => {
  for (const path of ['../escape', 'data/../../escape', '/absolute', 'C:/escape', 'data\\escape', 'data//empty']) {
    assert.throws(() => validateBackupImportManifest({ version: 1, files: [{ ...file, path }] }, []), /path/);
  }
  assert.throws(() => validateBackupImportManifest({ version: 1, files: [file, file] }, []), /Duplicate/);
});

test('rejects entry tampering, unlisted files and omitted listed files', () => {
  assert.throws(() => validateBackupImportManifest(manifest, [{ ...file, size: file.size + 1 }]), /size mismatch/);
  assert.throws(() => validateBackupImportManifest(manifest, [{ ...file, sha256: '0'.repeat(64) }]), /checksum mismatch/);
  assert.throws(() => validateBackupImportManifest(manifest, [{ ...file, path: 'other.json' }]), /Unlisted/);
  assert.throws(() => validateBackupImportManifest(manifest, []), /missing archive entries/);
  assert.throws(() => validateBackupImportManifest(manifest, [file, file]), /Duplicate/);
});

test('rejects invalid and excessive file sizes', () => {
  for (const size of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 128 * 1024 * 1024 + 1]) {
    assert.throws(() => validateBackupImportManifest({ version: 1, files: [{ ...file, size }] }, []), /size/);
  }
  assert.throws(() => validateBackupImportManifest({ version: 1, files: [{ ...file, size: 512 * 1024 * 1024 }] }, []), /size/);
});
