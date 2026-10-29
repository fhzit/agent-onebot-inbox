import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { runCli } from '../src/cli.js';
import { verifyBackupArchive } from '../src/backup-integrity.js';

function tarHeader(name: string, size: number, type = 48): Buffer {
  const h = Buffer.alloc(512);
  h.write(name); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.fill(32, 148, 156); h[156] = type;
  h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
function archive(): Buffer {
  const data = Buffer.from('hello');
  return Buffer.concat([tarHeader('file.txt', data.length), data, Buffer.alloc(512 - data.length), tarHeader('folder/', 0, 53), Buffer.alloc(1024)]);
}

test('verifies tar metadata and gzip without extracting or changing archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoi-backup-'));
  try {
    const tarPath = join(dir, 'backup.tar'), gzPath = join(dir, 'backup.tar.gz');
    const tar = archive(); await writeFile(tarPath, tar); await writeFile(gzPath, gzipSync(tar));
    assert.deepEqual(await verifyBackupArchive(tarPath), { format: 'tar', entries: 2, files: 1, directories: 1, totalBytes: 5 });
    assert.deepEqual(await verifyBackupArchive(gzPath), { format: 'tar.gz', entries: 2, files: 1, directories: 1, totalBytes: 5 });
    assert.deepEqual(await readFile(tarPath), tar);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects corrupt checksums, truncated archives, and corrupt gzip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoi-backup-'));
  try {
    const path = join(dir, 'bad.tar'); const bad = archive(); bad[0] ^= 1; await writeFile(path, bad);
    await assert.rejects(verifyBackupArchive(path), /checksum mismatch/);
    await writeFile(path, Buffer.alloc(512)); await assert.rejects(verifyBackupArchive(path), /end marker|truncated/);
    await writeFile(path, Buffer.from([0x1f, 0x8b, 0x00])); await assert.rejects(verifyBackupArchive(path), /gzip stream/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects tar links and special entry types', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoi-backup-'));
  try {
    const path = join(dir, 'special.tar');
    for (const type of [50, 51, 52, 54, 55, 120]) {
      const h = tarHeader('special', 0, type);
      await writeFile(path, Buffer.concat([h, Buffer.alloc(1024)]));
      await assert.rejects(verifyBackupArchive(path), /unsupported entry type/);
    }
    const h = tarHeader('dir', 1, 53);
    await writeFile(path, Buffer.concat([h, Buffer.alloc(1536)]));
    await assert.rejects(verifyBackupArchive(path), /directory entry has data/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects gzip decompression bombs and oversized plain archives', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoi-backup-'));
  try {
    const path = join(dir, 'bomb.tar.gz');
    await writeFile(path, gzipSync(Buffer.alloc(128 * 1024 * 1024 + 1)));
    await assert.rejects(verifyBackupArchive(path), /uncompressed size limit/);
    await writeFile(path, Buffer.alloc(64 * 1024 * 1024 + 1));
    await assert.rejects(verifyBackupArchive(path), /compressed size limit/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('backup-verify CLI works without API configuration and reports usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoi-backup-'));
  try {
    const path = join(dir, 'backup.tar'); await writeFile(path, archive());
    const output: string[] = [];
    await runCli(['backup-verify', path], {}, undefined, text => output.push(text));
    assert.equal(JSON.parse(output[0]!).entries, 2);
    await assert.rejects(runCli(['backup-verify'], {}), /Usage: aoi backup-verify/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
