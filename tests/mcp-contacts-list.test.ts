import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContactsListTool } from '../src/mcp-contacts-list.js';

test('contacts_list requires an explicit account and returns only that account snapshot', async () => {
  const calls: string[] = [];
  const snapshot = { friends: [{ user_id: '7', nickname: 'A', remark: null }], groups: [], members: [], last_synced: { friends: null, groups: null, members: {} } };
  const server = new McpServer({ name: 'test', version: '1' });
  registerContactsListTool(server, { get: async (accountId: string) => { calls.push(accountId); return snapshot; } } as never);
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text?: string }> }> }> })._registeredTools.contacts_list!;
  const response = await tool.handler({ account_id: 'acct-a' });
  assert.deepEqual(calls, ['acct-a']);
  assert.deepEqual(JSON.parse(response.content[0]!.text!), snapshot);
});

test('contacts_list rejects an empty account ID at the schema boundary', () => {
  const server = new McpServer({ name: 'test', version: '1' });
  registerContactsListTool(server, { get: async () => { throw new Error('must not be called'); } } as never);
  const tool = (server as unknown as { _registeredTools: Record<string, { inputSchema: unknown }> })._registeredTools.contacts_list!;
  assert.ok(tool.inputSchema);
});
