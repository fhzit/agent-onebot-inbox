import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { MemoryAccountStore } from '../src/account-store.js';
import { MemoryNotificationConfigStore } from '../src/notification-settings.js';
import { createAdditionalMcpHandlers } from '../src/mcp-additional-tools.js';

test('admin handler factory reads safe summaries from injected stores scoped to the requested account', async () => {
  const accounts = new MemoryAccountStore();
  await accounts.create({ id: 'a', alias: 'Alpha', self_id: '1', provider: 'napcat', enabled: true, permission: 'readonly', access_token: 'do-not-return' });
  const contacts = { get: async (id: string) => ({ friends: [{ user_id: id === 'a' ? '42' : 'wrong' }], groups: [{ group_id: 'g' }], members: [], last_synced: { friends: null, groups: null, members: {} } }) };
  const notifications = new MemoryNotificationConfigStore();
  await notifications.put({ enabled: true, webhookUrl: 'https://private.invalid/hook', webhookSecret: 'secret', minPriority: 'P1', includePreview: false, includeContext: false, timeoutMs: 5000, maxAttempts: 3 });
  const handlers = createAdditionalMcpHandlers({ accounts, contacts, notifications });
  assert.deepEqual(await handlers.contacts('a'), { friends: [{ user_id: '42' }], last_synced: { friends: null } });
  assert.deepEqual(await handlers.groups('a'), { groups: [{ group_id: 'g' }], last_synced: { groups: null } });
  assert.deepEqual(await handlers.health('a'), { id: 'a', alias: 'Alpha', self_id: '1', provider: 'napcat', enabled: true, permission: 'readonly', access_token_configured: true });
  assert.deepEqual(await handlers.notificationStatus('a'), { enabled: true, minPriority: 'P1', includePreview: false, includeContext: false, timeoutMs: 5000, maxAttempts: 3, webhook_configured: true, recent_deliveries: [] });
});

test('admin handler factory rejects unknown accounts before querying scoped stores', async () => {
  const accounts = new MemoryAccountStore(); let reads = 0;
  const handlers = createAdditionalMcpHandlers({ accounts, contacts: { get: async () => { reads++; throw new Error('unexpected'); } }, notifications: new MemoryNotificationConfigStore() });
  await assert.rejects(handlers.contacts('missing'), /Unknown account/);
  assert.equal(reads, 0);
});

async function setup() {
  const seen: string[] = [];
  const handler = async (id: string) => { seen.push(id); return { account: id, status: 'ok', webhookSecret: 'do-not-return', nested: { apiToken: 'also-secret' } }; };
  const service = createMcpService(loadConfig({ ACCOUNTS_JSON: '[]', API_TOKEN: 'token' }), new MessageStore(), undefined, undefined, { contacts: handler, groups: handler, health: handler, notificationStatus: handler });
  const server = service.server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, seen };
}

test('additional MCP handlers remain unit-testable but data tools are not registered without a trusted principal', async () => {
  const { client, seen } = await setup();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['service_info', 'system_status']);
  const status = await client.callTool({ name: 'system_status', arguments: {} });
  assert.deepEqual(status.content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0', status: 'ok', capabilities: { account_data: false, message_data: false, contacts: false, attachments: false, administration: false } }) }]);
  assert.equal(status.isError, undefined);
  assert.deepEqual(seen, []);
  await client.close();
});

test('MCP data tool registrations remain absent even when optional admin handlers are supplied', async () => {
  const noop = async () => null;
  const service = createMcpService(loadConfig({ ACCOUNTS_JSON: '[]', API_TOKEN: 'token' }), new MessageStore(), undefined, undefined, { contacts: noop, groups: noop, health: noop, notificationStatus: noop });
  const registered = (service.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  assert.deepEqual(Object.keys(registered).sort(), ['service_info', 'system_status']);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([client.connect(clientTransport), service.server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['service_info', 'system_status']);
  const status = await client.callTool({ name: 'system_status', arguments: {} });
  assert.deepEqual(status.content, [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0', status: 'ok', capabilities: { account_data: false, message_data: false, contacts: false, attachments: false, administration: false } }) }]);
  assert.equal(status.isError, undefined);
  await client.close();
});
