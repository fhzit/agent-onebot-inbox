import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindAiAdvisoryPanel } from '../src/admin-ai-advisory-panel.js';

test('a late response for the previously selected account cannot overwrite the new selection', async () => {
  const elements = new Map<string, any>();
  const makeElement = () => ({
    textContent: '', hidden: true, disabled: false, children: [] as any[],
    addEventListener() {},
    replaceChildren() { this.children = []; },
    append(...children: any[]) { this.children.push(...children); },
    ownerDocument: { createElement: () => ({ textContent: '', children: [] as any[], append(...children: any[]) { this.children.push(...children); } }) },
  });
  for (const selector of ['[data-ai-advisory-status]', '[data-ai-advisory-list]', '[data-ai-advisory-load]', '[data-ai-advisory-more]']) elements.set(selector, makeElement());
  const root = { querySelector: (selector: string) => elements.get(selector) ?? null };
  let selectedAccount = 'old-account';
  const pending = new Map<string, (value: unknown) => void>();
  const panel = bindAiAdvisoryPanel({
    root, accountId: () => selectedAccount,
    get: path => new Promise(resolve => pending.set(new URLSearchParams(path.split('?')[1]).get('account_id')!, resolve)),
  });

  const oldLoad = panel.load();
  selectedAccount = 'new-account';
  const newLoad = panel.load();
  assert.deepEqual([...pending.keys()], ['old-account', 'new-account']);

  pending.get('new-account')!({ advisories: [{ messageId: 'new', label: 'new-account-result', confidence: 1, model: 'model', policyVersion: 'p1', createdAt: 'now' }], nextCursor: null });
  await newLoad;
  pending.get('old-account')!({ advisories: [{ messageId: 'old', label: 'old-account-result', confidence: 1, model: 'model', policyVersion: 'p1', createdAt: 'now' }], nextCursor: null });
  await oldLoad;

  const list = elements.get('[data-ai-advisory-list]');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'new-account-result');
  assert.match(elements.get('[data-ai-advisory-status]').textContent, /1 advisory record/);
});
