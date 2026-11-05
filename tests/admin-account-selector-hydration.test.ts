import assert from 'node:assert/strict';
import { test } from 'node:test';
import { populateAiAdvisoryAccounts } from '../src/admin-account-selector-hydration.js';

function makeOption() { return { value: '', textContent: '' as string | null }; }
function makeSelect(value: string) {
  return { value, options: [] as ReturnType<typeof makeOption>[], replaceChildren(...nodes: ReturnType<typeof makeOption>[]) { this.options = nodes; }, append(node: ReturnType<typeof makeOption>) { this.options.push(node); } };
}

test('hydrates advisory and retention selectors with safe labels and preserves valid selections', () => {
  const selectors = new Map([['aiAdvisoryAccount', makeSelect('acct-2')], ['retentionAccount', makeSelect('acct-2')]]);
  const root = { getElementById: (id: string) => selectors.get(id) ?? null, createElement: (_tag: string) => makeOption() };
  const accounts = [{ id: 'acct-1', alias: '<b>One</b>' }, { id: 'acct-2', alias: 'Second' }];
  populateAiAdvisoryAccounts(accounts, root);
  for (const selector of selectors.values()) {
    assert.equal(selector.value, 'acct-2');
    assert.deepEqual(selector.options.map(option => option.value), ['', 'acct-1', 'acct-2']);
    assert.equal(selector.options[1]?.textContent, '<b>One</b> (acct-1)');
  }
  selectors.get('aiAdvisoryAccount')!.value = 'removed';
  populateAiAdvisoryAccounts([accounts[1]!], root);
  assert.equal(selectors.get('aiAdvisoryAccount')!.value, '');
});
