import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createStdioMcpService } from '../src/mcp-main.js';

test('stdio MCP exposes only safe static metadata without a trusted caller principal', async () => {
  const config = loadConfig({ API_TOKEN: 'not-used', ACCOUNTS_JSON: '[]' });
  const service = await createStdioMcpService(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-tool-inventory-test', version: '1' });
  await Promise.all([client.connect(clientTransport), service.server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['service_info', 'system_status']);
  const result = await client.callTool({ name: 'system_status', arguments: {} });
  assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0', status: 'ok', capabilities: { account_data: false, message_data: false, contacts: false, attachments: false, administration: false } }) }]);
  assert.equal(result.isError, undefined);
  assert.deepEqual((await client.callTool({ name: 'service_info', arguments: {} })).content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0' }) }]);

  await client.close();
  serverTransport.onmessage = undefined;
  serverTransport.onclose = undefined;
  clientTransport.onmessage = undefined;
  clientTransport.onclose = undefined;
});
