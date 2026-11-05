/** Admin-page acceptance contract for the AI advisory panel. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bindAiAdvisoryPanel } from '../src/admin-ai-advisory-panel.js';
import { adminPage } from '../src/admin-page.js';

const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const embeddedHtml = adminPage.toString();

test('admin page exposes an operable, accessible advisory panel contract', () => {
  const panel = html.match(/<section id="ai-advisory-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(panel, 'advisory panel exists in the shipped admin page');
  assert.match(panel, /<h2>AI 分类建议<\/h2>/);
  assert.match(panel, /<select id="aiAdvisoryAccount" aria-label="选择账号">/);
  assert.match(panel, /<button id="aiAdvisoryLoad" type="button">加载建议<\/button>/);
  assert.match(panel, /<button id="aiAdvisoryMore" type="button" hidden>加载更多<\/button>/);
  assert.match(panel, /id="aiAdvisoryStatus"[^>]*aria-live="polite"/);
  assert.match(panel, /id="aiAdvisoryList"/);
  assert.match(embeddedHtml, /bindAiAdvisoryPanel\(\{root:document,accountId:/);
  assert.match(embeddedHtml, /populateAiAdvisoryAccounts\(accounts\)/);
});

class FakeElement {
  textContent = '';
  hidden = false;
  disabled = false;
  value = '';
  children: FakeElement[] = [];
  listeners = new Map<string, () => void>();
  ownerDocument = { createElement: () => new FakeElement() };
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.(); }
  append(...items: FakeElement[]) { this.children.push(...items); }
  replaceChildren(...items: FakeElement[]) { this.children = items; }
}

test('account selection, paging, live status, and hostile labels behave through UI controls', async () => {
  const elements = new Map<string, FakeElement>();
  for (const selector of ['[data-ai-advisory-status]', '[data-ai-advisory-list]', '[data-ai-advisory-load]', '[data-ai-advisory-more]', '#aiAdvisoryAccount']) elements.set(selector, new FakeElement());
  const root = { querySelector: (selector: string) => elements.get(selector) ?? null } as unknown as ParentNode;
  const status = elements.get('[data-ai-advisory-status]')!;
  const list = elements.get('[data-ai-advisory-list]')!;
  const load = elements.get('[data-ai-advisory-load]')!;
  const more = elements.get('[data-ai-advisory-more]')!;
  let selectedAccount = '';
  const requests: string[] = [];
  const hostile = '<img src=x onerror=alert(1)>';
  const panel = bindAiAdvisoryPanel({ root, accountId: () => selectedAccount, get: async path => {
    requests.push(path);
    return requests.length === 1
      ? { advisories: [{ messageId: 'm-1', label: hostile, confidence: 0.9, model: 'model-x', policyVersion: 'p1', createdAt: '2026-01-01T00:00:00.000Z' }], nextCursor: { before: '2026-01-01T00:00:00.000Z', before_message_id: 'm-1' } }
      : { advisories: [], nextCursor: null };
  } });

  load.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(status.textContent, /Select an account/);
  assert.equal(requests.length, 0, 'must not issue an account-ambiguous request');

  selectedAccount = 'acct/a & b';
  await panel.load();
  assert.match(requests[0]!, /^\/api\/ai-advisories\?account_id=acct%2Fa\+%26\+b&limit=50$/);
  assert.equal(status.textContent, 'Showing 1 advisory record.');
  assert.equal(more.hidden, false);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0]!.children[0]!.textContent, hostile);
  assert.equal(list.children[0]!.children[0]!.children.length, 0, 'untrusted label is rendered as text, not parsed markup');

  more.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(requests[1]!, /before=2026-01-01T00%3A00%3A00\.000Z/);
  assert.match(requests[1]!, /before_message_id=m-1/);
  assert.equal(more.hidden, true);
  assert.equal(status.textContent, 'No more advisories.');
});
