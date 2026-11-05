import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAiAdvisoriesTool } from '../src/mcp-ai-advisories.js';
import type { AiAdvisoryRecord } from '../src/ai-advisory-store.js';

const records: AiAdvisoryRecord[] = [
  { accountId: 'acct-1', messageId: 'm-1', label: 'urgent', confidence: 0.9, model: 'model-x', policyVersion: 'v1', createdAt: '2025-01-01T00:00:00.000Z' },
  { accountId: 'acct-1', messageId: 'm-2', label: 'follow-up', confidence: 0.7, model: 'model-x', policyVersion: 'v1', createdAt: '2024-12-31T00:00:00.000Z' },
  { accountId: 'acct-2', messageId: 'foreign', label: 'private', confidence: 1, model: 'secret-model', policyVersion: 'v9', createdAt: '2025-01-01T00:00:00.000Z' },
];

async function withTool(store: { list: (accountId: string, options: { limit?: number; before?: string; beforeMessageId?: string }) => Promise<AiAdvisoryRecord[]> }, run: (client: Client) => Promise<void>) {
  const server = new McpServer({ name: 'test', version: '1' });
  registerAiAdvisoriesTool(server, store, ['acct-1']);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

test('AI advisory tool scopes explicit account, bounds page and exposes metadata only', async () => {
  const calls: Array<{ accountId: string; options: { limit?: number; before?: string; beforeMessageId?: string } }> = [];
  const store = { list: async (accountId: string, options: { limit?: number; before?: string; beforeMessageId?: string } = {}) => {
    calls.push({ accountId, options });
    return records.filter(row => row.accountId === accountId).slice(0, options.limit ?? 50);
  } };
  await withTool(store, async client => {
    const result = await client.callTool({ name: 'ai_advisories_list', arguments: { account_id: 'acct-1', limit: 1 } });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.deepEqual(data.advisories.map((row: { message_id: string }) => row.message_id), ['m-1']);
    assert.equal(data.account_id, 'acct-1');
    assert.equal(calls[0]!.accountId, 'acct-1');
    assert.equal(calls[0]!.options.limit, 1);
    assert.equal(JSON.stringify(data).includes('secret'), false);
    assert.equal(JSON.stringify(data).includes('reason'), false);
  });
});

test('AI advisory tool requires explicit identifiers, bounds limits, and pairs cursor fields', async () => {
  let called = false;
  await withTool({ list: async () => { called = true; return []; } }, async client => {
    for (const args of [
      { limit: 2 },
      { account_id: '' },
      { account_id: 'acct-1', limit: 101 },
      { account_id: 'acct-1', before_created_at: '2025-01-01T00:00:00Z' },
      { account_id: 'acct-1', before_message_id: 'm-1' },
    ]) {
      const result = await client.callTool({ name: 'ai_advisories_list', arguments: args });
      assert.equal(result.isError, true);
    }
    assert.equal(called, false);
  });
});

test('AI advisory tool rejects accounts outside its explicit allowlist without querying storage', async () => {
  let called = false;
  await withTool({ list: async () => { called = true; return records; } }, async client => {
    const result = await client.callTool({ name: 'ai_advisories_list', arguments: { account_id: 'acct-2' } });
    assert.equal(result.isError, true);
    assert.match((result.content as Array<{ text: string }>)[0]!.text, /not authorized/);
    assert.equal(called, false);
  });
});

test('AI advisory tool forwards the explicit composite cursor', async () => {
  let received: unknown;
  await withTool({ list: async (_accountId, options) => { received = options; return []; } }, async client => {
    const result = await client.callTool({ name: 'ai_advisories_list', arguments: { account_id: 'acct-1', before_created_at: '2025-01-01T00:00:00Z', before_message_id: 'm-1' } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(received, { limit: 50, before: '2025-01-01T00:00:00Z', beforeMessageId: 'm-1' });
  });
});
