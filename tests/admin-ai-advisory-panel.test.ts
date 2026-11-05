/** DOM-mock coverage for safe account-scoped advisory browsing. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindAiAdvisoryPanel } from '../src/admin-ai-advisory-panel.js';

class Element {
  textContent = '';
  hidden = false;
  disabled = false;
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  dataset: Record<string, string> = {};
  ownerDocument = { createElement: () => new Element() };
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.(); }
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; }
}
function fixture() {
  const elements = new Map(['[data-ai-advisory-status]', '[data-ai-advisory-list]', '[data-ai-advisory-load]', '[data-ai-advisory-more]'].map(k => [k, new Element()]));
  const root = { querySelector: (selector: string) => elements.get(selector) ?? null } as unknown as ParentNode;
  return { root, status: elements.get('[data-ai-advisory-status]')!, list: elements.get('[data-ai-advisory-list]')!, load: elements.get('[data-ai-advisory-load]')!, more: elements.get('[data-ai-advisory-more]')! };
}
const record = { messageId: 'm1', label: '<img src=x onerror=alert(1)>', confidence: .9, model: 'model', policyVersion: 'v1', createdAt: '2026-01-01T00:00:00.000Z' };

test('loads only for selected account, encodes account, renders metadata as text and paginates', async () => {
  const f = fixture(); const paths: string[] = [];
  const panel = bindAiAdvisoryPanel({ root: f.root, accountId: () => 'acct/a', pageSize: 999, get: async path => { paths.push(path); return paths.length === 1 ? { advisories: [record], nextCursor: { before: record.createdAt, before_message_id: record.messageId } } : { advisories: [], nextCursor: null }; } });
  await panel.load();
  assert.match(paths[0]!, /^\/api\/ai-advisories\?account_id=acct%2Fa&limit=100$/);
  assert.equal(f.list.children.length, 1);
  assert.equal(f.list.children[0]!.children[0]!.textContent, record.label);
  assert.equal(f.list.children[0]!.children[0]!.children.length, 0);
  assert.equal(f.more.hidden, false);
  await panel.loadMore();
  assert.match(paths[1]!, /before=2026-01-01T00%3A00%3A00\.000Z/);
  assert.match(paths[1]!, /before_message_id=m1/);
  assert.equal(f.more.hidden, true);
});

test('uses root or configured deployment base path and retains account query values', async () => {
  for (const [basePath, expectedPath] of [[undefined, '/api/ai-advisories'], ['/console/', '/console/api/ai-advisories']] as const) {
    const f = fixture(); const paths: string[] = [];
    const panel = bindAiAdvisoryPanel({ root: f.root, accountId: () => 'acct/a', basePath, get: async path => { paths.push(path); return { advisories: [], nextCursor: null }; } });
    await panel.load();
    assert.equal(paths[0], `${expectedPath}?account_id=acct%2Fa&limit=50`);
  }
});


test('refuses missing account and presents safe loading, empty and failure states', async () => {
  const f = fixture(); let calls = 0;
  const panel = bindAiAdvisoryPanel({ root: f.root, accountId: () => '', get: async () => { calls++; return {}; } });
  await panel.load(); assert.equal(calls, 0); assert.match(f.status.textContent, /Select an account/);
  const good = bindAiAdvisoryPanel({ root: f.root, accountId: () => 'acct', get: async () => ({ advisories: [], nextCursor: null }) });
  await good.load(); assert.match(f.status.textContent, /No advisories/);
  const bad = bindAiAdvisoryPanel({ root: f.root, accountId: () => 'acct', get: async () => { throw new Error('<script>secret</script>'); } });
  await bad.load(); assert.match(f.status.textContent, /Could not load/); assert.doesNotMatch(f.status.textContent, /script|secret/);
});
