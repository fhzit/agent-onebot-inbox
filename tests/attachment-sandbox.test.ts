import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAllowedFile } from '../src/attachments/sandbox.js';

test('file sandbox permits regular files under allowlisted root', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'aoi-files-'));
  try {
    const root = path.join(base, 'share'); await mkdir(root);
    const file = path.join(root, 'report.pdf'); await writeFile(file, 'pdf');
    const resolved = await resolveAllowedFile(file, [root], 20);
    assert.equal(resolved.size, 3);
    assert.equal(resolved.realPath, file);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('file sandbox rejects traversal, symlink escape, directories, and oversized files', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'aoi-files-'));
  try {
    const root = path.join(base, 'share'); await mkdir(root);
    const outside = path.join(base, 'outside.txt'); await writeFile(outside, 'outside');
    const link = path.join(root, 'shortcut'); await symlink(outside, link);
    await assert.rejects(resolveAllowedFile(path.join(root, '..', 'outside.txt'), [root], 100), /outside allowed roots/);
    await assert.rejects(resolveAllowedFile(link, [root], 100), /outside allowed roots/);
    await assert.rejects(resolveAllowedFile(root, [root], 100), /regular file/);
    await assert.rejects(resolveAllowedFile(outside, [root], 100), /outside allowed roots/);
    const large = path.join(root, 'large.txt'); await writeFile(large, '123456');
    await assert.rejects(resolveAllowedFile(large, [root], 5), /size limit/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
