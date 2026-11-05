import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflightAiAdvisorySource } from '../scripts/preflight-ai-advisory-source.mjs';

test('source preflight validates hooks and does not create an enabled marker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-advisory-preflight-'));
  const serverPath = join(dir, 'server.ts');
  const adminPath = join(dir, 'admin.html');
  const markerPath = join(dir, '.ai-advisory-pipeline-ready');
  try {
    await writeFile(serverPath, `import { persistIncomingAiAdvisory } from './runtime.js';\nurl.pathname === '/api/ai-advisories'`);
    await writeFile(adminPath, '<section data-ai-advisory-panel></section>');
    await preflightAiAdvisorySource({ serverPath, adminPath });
    await assert.rejects(readFile(markerPath), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('source preflight fails when a required hook is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-advisory-preflight-'));
  const serverPath = join(dir, 'server.ts');
  const adminPath = join(dir, 'admin.html');
  try {
    await writeFile(serverPath, 'export const server = true;');
    await writeFile(adminPath, '<section data-ai-advisory-panel></section>');
    await assert.rejects(preflightAiAdvisorySource({ serverPath, adminPath }), /runtime import must exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
