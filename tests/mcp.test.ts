import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('MCP registers account and searchable inbox tools with strict inputs', async () => {
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id: 'main', alias: 'Main', self_id: '100', provider: 'napcat', access_token: 'secret' }]), API_TOKEN: 'token' });
  const store = new MessageStore();
  store.insert(normalizeEvent('main', 'napcat', 'fixture', { post_type: 'message', message_type: 'private', self_id: '100', user_id: '200', message_id: 1, time: 1700000000, message: 'hello teacher' })!);
  const mcp = createMcpService(config, store).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'accounts_list'));
    assert.ok(listed.tools.some(tool => tool.name === 'inbox_search'));
    const accounts = await client.callTool({ name: 'accounts_list', arguments: {} });
    const accountsText = (accounts.content as Array<{ text: string }>)[0]?.text ?? '';
    assert.match(accountsText, /"id":"main"/);
    const searched = await client.callTool({ name: 'inbox_search', arguments: { query: 'teacher', account_id: 'main' } });
    assert.match(JSON.stringify(searched), /hello teacher/);
    const invalid = await client.callTool({ name: 'inbox_search', arguments: { query: '' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await mcp.close(); }
});
