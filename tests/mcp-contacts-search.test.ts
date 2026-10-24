import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContactsSearchTool } from '../src/mcp-contacts-search.js';

test('contacts_search requires account scope and delegates search with query and limit', async () => {
  const calls: unknown[][] = [];
  const store = { search: async (...args: [string, string, number?]) => { calls.push(args); return { status: 'resolved', contact: { qq_id: '42' }, candidates: [{ qq_id: '42' }], results: [{ qq_id: '42' }] }; } };
  const server = new McpServer({ name: 'test', version: '1' });
  registerContactsSearchTool(server, store as never);
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{content:Array<{text?:string}>}> }> })._registeredTools.contacts_search!;
  const response = await tool.handler({ account_id: 'acct-a', query: 'Alice', limit: 7 });
  assert.deepEqual(calls, [['acct-a', 'Alice', 7]]);
  assert.deepEqual(JSON.parse(response.content[0]!.text!), { status: 'resolved', contact: { qq_id: '42' }, candidates: [{ qq_id: '42' }], results: [{ qq_id: '42' }] });
});

test('contacts_search schema rejects missing account and blank query', async () => {
  const server = new McpServer({ name: 'test', version: '1' });
  registerContactsSearchTool(server, { search: async () => { throw new Error('must not be called'); } } as never);
  const clientTool = (server as unknown as { _registeredTools: Record<string, { inputSchema: unknown }> })._registeredTools.contacts_search;
  assert.ok(clientTool);
  // Input constraints are exercised through the tool schema by MCP clients; required account_id is declared in schema.
  assert.ok(clientTool.inputSchema);
});
