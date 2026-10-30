import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupSha256 } from '../src/backup-manifest-validation.js';
import { executeBackupRestore } from '../src/backup-restore-executor.js';

const entry = (path: string, value: string) => ({ path, data: Buffer.from(value) });
const manifest = (...entries: ReturnType<typeof entry>[]) => ({ version: 1, files: entries.map(({ path, data }) => ({ path, size: data.length, sha256: backupSha256(data) })) });

test('dry-run is the default and writes nothing', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'restore-executor-'));
  const root = join(parent, 'restore');
  const file = entry('nested/file.txt', 'payload');
  try {
    const result = await executeBackupRestore(root, manifest(file), [file]);
    assert.equal(result.mode, 'dry-run');
    assert.deepEqual(result.written, []);
    await assert.rejects(readFile(join(root, 'nested/file.txt')));
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('apply creates validated files without overwriting', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'restore-executor-'));
  const root = join(parent, 'restore');
  const file = entry('nested/file.txt', 'payload');
  try {
    const result = await executeBackupRestore(root, manifest(file), [file], { apply: true });
    assert.equal(result.mode, 'applied');
    assert.deepEqual(result.written, [join(root, 'nested/file.txt')]);
    assert.equal(await readFile(join(root, 'nested/file.txt'), 'utf8'), 'payload');
    await assert.rejects(executeBackupRestore(root, manifest(file), [file], { apply: true }), /EEXIST/);
    assert.equal(await readFile(join(root, 'nested/file.txt'), 'utf8'), 'payload');
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('rejects symlinked root and nested directories during apply', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'restore-executor-'));
  const outside = join(parent, 'outside');
  const rootLink = join(parent, 'root-link');
  const nestedRoot = join(parent, 'nested-root');
  const file = entry('nested/file.txt', 'payload');
  try {
    await mkdir(outside);
    await symlink(outside, rootLink);
    await assert.rejects(executeBackupRestore(rootLink, manifest(file), [file], { apply: true }), /real directory/);
    await mkdir(nestedRoot);
    await symlink(outside, join(nestedRoot, 'nested'));
    await assert.rejects(executeBackupRestore(nestedRoot, manifest(file), [file], { apply: true }), /real directory/);
    await assert.rejects(readFile(join(outside, 'file.txt')));
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('rejects traversal before applying any payload', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'restore-executor-'));
  const root = join(parent, 'restore');
  const safe = entry('safe.txt', 'ok');
  const bad = entry('../escape.txt', 'bad');
  try {
    await assert.rejects(executeBackupRestore(root, manifest(safe, bad), [safe, bad], { apply: true }), /path/);
    await assert.rejects(readFile(join(parent, 'escape.txt')));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
