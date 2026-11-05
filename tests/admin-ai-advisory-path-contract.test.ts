/** Characterization contract for the admin advisory endpoint's base-path behavior. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindAiAdvisoryPanel } from '../src/admin-ai-advisory-panel.js';

class Element {
  textContent = '';
  hidden = false;
  disabled = false;
  ownerDocument = { createElement: () => new Element() };
  addEventListener() {}
  replaceChildren() {}
  append() {}
}

function requestPath() {
  const selectors = new Set(['[data-ai-advisory-status]', '[data-ai-advisory-list]', '[data-ai-advisory-load]', '[data-ai-advisory-more]']);
  const root = { querySelector: (selector: string) => selectors.has(selector) ? new Element() : null } as unknown as ParentNode;
  let path = '';
  const panel = bindAiAdvisoryPanel({
    root,
    accountId: () => 'account-1',
    get: async requestedPath => { path = requestedPath; return { advisories: [], nextCursor: null }; },
  });
  return panel.load().then(() => path);
}

test('admin advisory fetch remains rooted at /api when admin is served at site root', async () => {
  assert.equal(await requestPath(), '/api/ai-advisories?account_id=account-1&limit=50');
});

test('KNOWN LIMITATION: admin advisory fetch does not inherit a deployment subpath', async () => {
  const actual = await requestPath();
  const expectedUnderSubpath = '/console/api/ai-advisories?account_id=account-1&limit=50';

  // This passing assertion deliberately records the current contract (and failure
  // mode): a subpath-aware expectation does not match the root-relative request.
  assert.notEqual(actual, expectedUnderSubpath);
  assert.equal(actual, '/api/ai-advisories?account_id=account-1&limit=50');
});
