import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { retrieveAttachment } from '../src/attachments/retrieval.js';

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'aoi-retrieval-'));
  const root = path.join(base, 'allowed');
  await mkdir(root);
  return { base, root };
}

test('retrieves provider file by ID from an allowlisted root', async () => {
  const { base, root } = await fixture();
  try {
    const file = path.join(root, 'doc.bin');
    await writeFile(file, Buffer.from('payload'));
    const result = await retrieveAttachment('provider-id', async id => {
      assert.equal(id, 'provider-id');
      return file;
    }, [root], 32);
    assert.equal(result.filename, 'doc.bin');
    assert.deepEqual(result.bytes, Buffer.from('payload'));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects traversal and symlink escape returned by provider retrieval', async () => {
  const { base, root } = await fixture();
  try {
    const outside = path.join(base, 'outside');
    await writeFile(outside, 'secret');
    await symlink(outside, path.join(root, 'link'));
    await assert.rejects(retrieveAttachment('id', async () => path.join(root, '..', 'outside'), [root], 32), /outside allowed roots/);
    await assert.rejects(retrieveAttachment('id', async () => path.join(root, 'link'), [root], 32), /outside allowed roots/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects a symlinked file descriptor target outside the allowed root', async () => {
  const { base, root } = await fixture();
  try {
    const outside = path.join(base, 'outside');
    const link = path.join(root, 'link');
    await writeFile(outside, 'secret');
    await symlink(outside, link);
    await assert.rejects(retrieveAttachment('id', async () => link, [root], 32), /outside allowed roots/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects oversized files before reading their full contents', async () => {
  const { base, root } = await fixture();
  try {
    const file = path.join(root, 'large');
    await writeFile(file, Buffer.alloc(1024 * 1024));
    await assert.rejects(retrieveAttachment('id', async () => file, [root], 5), /size limit/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects oversized files and never accepts URL-like provider output', async () => {
  const { base, root } = await fixture();
  try {
    const file = path.join(root, 'large');
    await writeFile(file, '123456');
    await assert.rejects(retrieveAttachment('id', async () => file, [root], 5), /size limit/);
    await assert.rejects(retrieveAttachment('id', async () => 'https://attacker.invalid/file', [root], 100), /absolute/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
