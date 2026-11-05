import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createStdioMcpService } from '../src/mcp-main.js';

test('stdio MCP factory exposes only safe static tools without a trusted caller principal', async () => {
  const config = loadConfig({ API_TOKEN: 'not-used', ACCOUNTS_JSON: '[]' });
  const service = await createStdioMcpService(config, {
    accounts: { async list() { return [{ id: 'acct-1' } as never]; } },
    contacts: { async get(accountId) { assert.equal(accountId, 'acct-1'); return { friends: [{ user_id: '7' }], groups: [], members: [], last_synced: { friends: null, groups: null, members: {} } }; } },
    notifications: { async get() { return { enabled: false, webhookUrl: 'https://secret.invalid/path', webhookSecret: 'secret-value', minPriority: 'P1', includePreview: false, timeoutMs: 5000, maxAttempts: 3 }; } },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'stdio-runtime-test', version: '1' });
  await Promise.all([client.connect(clientTransport), service.server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['service_info', 'system_status']);
  const status = await client.callTool({ name: 'system_status', arguments: {} });
  assert.deepEqual(status.content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0', status: 'ok', capabilities: { account_data: false, message_data: false, contacts: false, attachments: false, administration: false } }) }]);
  assert.equal(status.isError, undefined);
  await client.close();
  serverTransport.onmessage = undefined;
  serverTransport.onclose = undefined;
  clientTransport.onmessage = undefined;
  clientTransport.onclose = undefined;
});
