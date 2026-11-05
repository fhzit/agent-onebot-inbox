import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Validate that the expected advisory source hooks exist.
 * This is a static source preflight only: it does not configure the application,
 * run database migrations, or indicate that the pipeline is enabled.
 */
export async function preflightAiAdvisorySource(input = {}) {
  const serverPath = resolve(input.serverPath ?? 'src/server.ts');
  const adminPath = resolve(input.adminPath ?? 'public/admin.html');
  const [server, admin] = await Promise.all([
    readFile(serverPath, 'utf8'),
    readFile(adminPath, 'utf8'),
  ]);

  assert(server.includes("import { persistIncomingAiAdvisory"), 'runtime import must exist');
  assert(server.includes("url.pathname === '/api/ai-advisories'"), 'read API route must exist');
  assert(admin.includes('data-ai-advisory-panel'), 'admin panel markup must exist');
}
