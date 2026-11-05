import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createStdioMcpService } from '../src/mcp-main.js';

/**
 * Characterizes the current boundary, not a desired authorization policy:
 * MCP registration callbacks accept tool arguments only and do not receive an
 * authenticated principal. HTTP transport authentication must not be mistaken
 * for per-tool/account authorization.
 */
test('default service exposes no tools when caller account scope is absent', async () => {
  const config = loadConfig({ API_TOKEN: 'not-used', ACCOUNTS_JSON: '[]' });
  const service = await createStdioMcpService(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-data-tool-principal-contract-test', version: '1' });
  await Promise.all([client.connect(clientTransport), service.server.connect(serverTransport)]);

  // Safe static tools are available, but account/message tools are withheld.
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['service_info', 'system_status']);
  const status = await client.callTool({ name: 'system_status', arguments: {} });
  assert.deepEqual(status.content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0', status: 'ok', capabilities: { account_data: false, message_data: false, contacts: false, attachments: false, administration: false } }) }]);
  assert.equal(status.isError, undefined);
  assert.equal(tools.some(tool => /account|message|history|attachment|contact/i.test(tool.name)), false);

  await client.close();
  serverTransport.onmessage = undefined;
  serverTransport.onclose = undefined;
  clientTransport.onmessage = undefined;
  clientTransport.onclose = undefined;
});
