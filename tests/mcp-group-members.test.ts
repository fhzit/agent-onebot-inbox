import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGroupMembersTool } from '../src/mcp-group-members.js';

const handler = (server: McpServer) => (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text?: string }> }> }> })._registeredTools.group_members!.handler;

test('group_members returns stable account/group scoped pages from cached members', async () => {
  const calls: string[] = [];
  const server = new McpServer({ name: 'test', version: '1' });
  const members = ['1', '2', '3', '4'].map(user_id => ({ user_id, nickname: `user-${user_id}` }));
  registerGroupMembersTool(server, { get: async (account: string) => { calls.push(account); return { friends: [], groups: [], members: [{ group_id: 'g1', members }, { group_id: 'g2', members: [{ user_id: 'other' }] }], last_synced: { friends: null, groups: null, members: {} } }; } } as never);
  const run = handler(server);
  const first = await run({ account_id: 'a1', group_id: 'g1', offset: 1, limit: 2 });
  const second = await run({ account_id: 'a1', group_id: 'g1', offset: 1, limit: 2 });
  assert.deepEqual(JSON.parse(first.content[0]!.text!), { account_id: 'a1', group_id: 'g1', members: members.slice(1, 3), offset: 1, limit: 2, total: 4 });
  assert.equal(first.content[0]!.text, second.content[0]!.text);
  const other = await run({ account_id: 'a2', group_id: 'g2' });
  assert.deepEqual(JSON.parse(other.content[0]!.text!), { account_id: 'a2', group_id: 'g2', members: [{ user_id: 'other' }], offset: 0, limit: 50, total: 1 });
  assert.deepEqual(calls, ['a1', 'a1', 'a2']);
});

test('group_members missing group has an empty page and validates bounded pagination', async () => {
  let called = false;
  const server = new McpServer({ name: 'test', version: '1' });
  registerGroupMembersTool(server, { get: async () => { called = true; return { friends: [], groups: [], members: [], last_synced: { friends: null, groups: null, members: {} } }; } } as never);
  const run = handler(server);
  const missing = await run({ account_id: 'a', group_id: 'missing' });
  assert.deepEqual(JSON.parse(missing.content[0]!.text!), { account_id: 'a', group_id: 'missing', members: [], offset: 0, limit: 50, total: 0 });
  const tool = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools.group_members;
  const validate = (server as unknown as { validateToolInput: (tool: unknown, args: unknown, name: string) => Promise<unknown> }).validateToolInput;
  for (const args of [
    { account_id: '', group_id: 'g' }, { account_id: 'a', group_id: '' },
    { account_id: 'a', group_id: 'g', offset: -1 }, { account_id: 'a', group_id: 'g', offset: 1.5 },
    { account_id: 'a', group_id: 'g', limit: 0 }, { account_id: 'a', group_id: 'g', limit: 201 },
  ]) await assert.rejects(() => validate.call(server, tool, args, 'group_members'), /Input validation error/);
  assert.equal(called, true);
});
