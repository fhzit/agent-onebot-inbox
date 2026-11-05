/** Characterize the inline advisory panel's base-path request routing. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindAiAdvisoryPanel } from '../src/admin-ai-advisory-panel.js';
import { startServer } from '../src/server.js';

class Element {
  textContent = '';
  hidden = false;
  disabled = false;
  ownerDocument = { createElement: () => new Element() };
  addEventListener() {}
  replaceChildren() {}
  append() {}
}

async function requestedPath(basePath?: string): Promise<string> {
  const selectors = new Set(['[data-ai-advisory-status]', '[data-ai-advisory-list]', '[data-ai-advisory-load]', '[data-ai-advisory-more]']);
  const root = { querySelector: (selector: string) => selectors.has(selector) ? new Element() : null } as unknown as ParentNode;
  let path = '';
  const panel = bindAiAdvisoryPanel({
    root,
    accountId: () => 'account-1',
    basePath,
    get: async requested => { path = requested; return { advisories: [], nextCursor: null }; },
  });
  await panel.load();
  return path;
}

test('inline advisory panel targets the root API path when no deployment prefix is supplied', async () => {
  assert.equal(await requestedPath(), '/api/ai-advisories?account_id=account-1&limit=50');
});

test('inline advisory panel routes through its explicitly supplied deployment prefix', async () => {
  assert.equal(await requestedPath('/console'), '/console/api/ai-advisories?account_id=account-1&limit=50');
  assert.equal(await requestedPath('/console/'), '/console/api/ai-advisories?account_id=account-1&limit=50');
});

test('inline advisory panel does not infer a browser URL subpath when basePath is omitted', async () => {
  const actual = await requestedPath();
  assert.notEqual(actual, '/console/api/ai-advisories?account_id=account-1&limit=50');
  assert.equal(actual, '/api/ai-advisories?account_id=account-1&limit=50');
});

test('served /console admin embeds AI advisory request to the root /api route', async () => {
  const port = 34000 + Math.floor(Math.random() * 500);
  const runtime = await startServer({ host: '127.0.0.1', port, adminBasePath: '/console', apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [] });
  try {
    const page = await fetch(`http://127.0.0.1:${port}/console`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /bindAiAdvisoryPanel\(\{root:document,accountId:/);
    assert.match(html, /get:path=>api\(path\)/);
    assert.doesNotMatch(html, /basePath:\s*['"]\/console/);

    // ADMIN_BASE_PATH mounts the page only; API dispatch remains root-scoped.
    const rootApi = await fetch(`http://127.0.0.1:${port}/api/ai-advisories?account_id=main`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(rootApi.status, 503); // Route exists, but advisory persistence is disabled.
    const prefixedApi = await fetch(`http://127.0.0.1:${port}/console/api/ai-advisories?account_id=main`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(prefixedApi.status, 404);
  } finally {
    await runtime.close();
  }
});
