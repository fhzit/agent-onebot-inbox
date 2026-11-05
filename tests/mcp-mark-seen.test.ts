import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('MCP withholds data tools without a trusted caller principal', async () => {
  const config = loadConfig({ API_TOKEN: 'test', ACCOUNTS_JSON: '[]' });
  const service = createMcpService(config, new MessageStore()).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'fail-closed-test', version: '1' });
  await Promise.all([service.connect(serverTransport), client.connect(clientTransport)]);
  try { const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['service_info', 'system_status']);
  const status = await client.callTool({ name: 'system_status', arguments: {} });
  assert.deepEqual(status.content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0', status: 'ok', capabilities: { account_data: false, message_data: false, contacts: false, attachments: false, administration: false } }) }]);
  assert.equal(status.isError, undefined); }
  finally { await client.close(); await service.close(); }
});
