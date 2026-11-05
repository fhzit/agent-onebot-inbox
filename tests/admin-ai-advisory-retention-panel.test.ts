import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { bindAiAdvisoryRetentionPanel } from '../src/admin-ai-advisory-retention-panel.js';

class Element {
  textContent = ''; hidden = false; disabled = false; children: Element[] = [];
  listeners = new Map<string, () => void>();
  ownerDocument = { createElement: () => new Element() };
  addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
  click() { this.listeners.get('click')?.(); }
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; }
}
const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
function fixture() {
  const elems = new Map(['[data-retention-status]', '[data-retention-list]', '[data-retention-preview]', '[data-retention-apply]'].map(x => [x, new Element()]));
  return { elems, root: { querySelector: (s: string) => elems.get(s) ?? null } as unknown as ParentNode };
}
function setup(approved: boolean) {
  const f = fixture(), calls: { path: string; body: unknown }[] = [], prompts: string[] = [];
  const panel = bindAiAdvisoryRetentionPanel({ root: f.root, accountId: () => 'acct/1', confirm: text => { prompts.push(text); return approved; }, post: async (path, body) => { calls.push({ path, body }); return path.endsWith('/preview') ? { confirmation_token: 'secret-token', accountId: 'acct/1', cutoff: '2026-01-01T00:00:00.000Z', retentionDays: 30, limit: 10, hasMore: false, candidates: [{ accountId: 'acct/1', messageId: 'msg-7', policyVersion: 'v1', body: 'must not appear' }] } : { requested: 1, deleted: 1 }; } });
  return { ...f, calls, prompts, panel };
}

test('admin template contains operator preview/apply controls and no message body field', () => {
  assert.match(html, /id="ai-advisory-retention-panel"/);
  assert.match(html, /data-retention-preview/);
  assert.match(html, /data-retention-apply/);
  assert.match(html, /仅清理建议元数据/);
});

test('renders real metadata DOM, hides message content, and only sends apply after explicit confirmation', async () => {
  const f = setup(false);
  assert.equal(f.elems.get('[data-retention-apply]')!.disabled, true);
  f.elems.get('[data-retention-preview]')!.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  assert.equal((f.calls[0]!.body as { accountId: string }).accountId, 'acct/1');
  const list = f.elems.get('[data-retention-list]')!;
  assert.equal(list.children.length, 1);
  const rendered = list.children[0]!;
  assert.match(rendered.children[1]!.textContent, /msg-7/);
  assert.doesNotMatch(JSON.stringify(rendered), /must not appear|body/);
  assert.equal(f.elems.get('[data-retention-apply]')!.disabled, false);
  f.elems.get('[data-retention-apply]')!.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.length, 1, 'declined confirmation must not call apply endpoint');
});

test('confirmed apply posts exact preview token/account and clears the actionable preview', async () => {
  const f = setup(true);
  f.elems.get('[data-retention-preview]')!.click(); await new Promise(resolve => setImmediate(resolve));
  f.elems.get('[data-retention-apply]')!.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.path, '/api/admin/ai-advisory-retention/apply');
  assert.deepEqual(f.calls[1]!.body, { accountId: 'acct/1', confirmation_token: 'secret-token' });
  assert.equal(f.elems.get('[data-retention-list]')!.children.length, 0);
  assert.equal(f.elems.get('[data-retention-apply]')!.disabled, true);
  assert.match(f.elems.get('[data-retention-status]')!.textContent, /deleted 1/);
});
