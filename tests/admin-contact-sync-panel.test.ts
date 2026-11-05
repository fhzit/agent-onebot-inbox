import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindContactSyncPanel } from '../src/admin-contact-sync-panel.js';

class Button {
  dataset: Record<string, string>;
  disabled = false;
  handler?: () => Promise<void>;
  constructor(kind: string) { this.dataset = { contactSync: kind }; }
  addEventListener(_name: string, handler: () => Promise<void>) { this.handler = handler; }
  async click() { await this.handler?.(); }
}
function root(buttons: Button[], group = ''): ParentNode {
  return { querySelectorAll: () => buttons, querySelector: () => ({ value: group }) } as unknown as ParentNode;
}

test('contact sync is explicitly scoped to selected account and refreshes after success', async () => {
  const button = new Button('friends'); const calls: unknown[][] = []; const messages: string[] = []; let refreshed = 0;
  bindContactSyncPanel(root([button]), { accountId: () => 'acct/a', post: async (...args) => { calls.push(args); return { synced: 3 }; }, status: m => messages.push(m), refresh: async () => { refreshed++; } });
  await button.click();
  assert.deepEqual(calls, [['/api/admin/accounts/acct%2Fa/contacts/sync-friends', {}]]);
  assert.equal(messages.at(-1), '同步完成：3 条'); assert.equal(refreshed, 1); assert.equal(button.disabled, false);
});

test('contact sync refuses missing account/group and reports provider errors', async () => {
  const member = new Button('members'); const messages: string[] = []; let calls = 0;
  bindContactSyncPanel(root([member]), { accountId: () => '', post: async () => { calls++; return {}; }, status: m => messages.push(m), refresh: async () => {} });
  await member.click(); assert.equal(messages.at(-1), '请先选择账号'); assert.equal(calls, 0);
  bindContactSyncPanel(root([member]), { accountId: () => 'acct', post: async () => { calls++; return {}; }, status: m => messages.push(m), refresh: async () => {} });
  await member.click(); assert.equal(messages.at(-1), '请输入群号'); assert.equal(calls, 0);
  bindContactSyncPanel(root([member], '123'), { accountId: () => 'acct', post: async () => { throw new Error('offline'); }, status: m => messages.push(m), refresh: async () => {} });
  await member.click(); assert.equal(messages.at(-1), '同步失败：offline'); assert.equal(calls, 0); assert.equal(member.disabled, false);
});
