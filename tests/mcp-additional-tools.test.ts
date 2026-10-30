import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';

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

test('additional tools scope every read to the explicitly supplied account and redact secrets', async () => {
  const { client, seen } = await setup();
  for (const name of ['admin_contacts', 'admin_groups', 'admin_health', 'admin_notification_status']) {
    const result = await client.callTool({ name, arguments: { account_id: 'acct-1' } });
    assert.equal(result.isError, undefined);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    assert.deepEqual(JSON.parse(text), { account: 'acct-1', status: 'ok', nested: {} });
  }
  assert.deepEqual(seen, ['acct-1', 'acct-1', 'acct-1', 'acct-1']);
  await client.close();
});

test('additional tools reject missing, blank, and malformed account IDs before handlers', async () => {
  const { client, seen } = await setup();
  for (const account_id of ['', '  ', '../other', 'bad/account']) {
    const result = await client.callTool({ name: 'admin_health', arguments: { account_id } });
    assert.equal(result.isError, true);
  }
  const missing = await client.callTool({ name: 'admin_health', arguments: {} });
  assert.equal(missing.isError, true);
  assert.deepEqual(seen, []);
  await client.close();
});

test('createMcpService registers and exposes admin tools when handlers are supplied', async () => {
  const noop = async () => null;
  const service = createMcpService(loadConfig({ ACCOUNTS_JSON: '[]', API_TOKEN: 'token' }), new MessageStore(), undefined, undefined, { contacts: noop, groups: noop, health: noop, notificationStatus: noop });
  const tools = (service.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  for (const name of ['admin_contacts', 'admin_groups', 'admin_health', 'admin_notification_status']) assert.ok(tools[name], `${name} should be registered`);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([client.connect(clientTransport), service.server.connect(serverTransport)]);
  const listed = await client.listTools();
  for (const name of ['admin_contacts', 'admin_groups', 'admin_health', 'admin_notification_status']) assert.ok(listed.tools.some(tool => tool.name === name), `${name} should be discoverable`);
  await client.close();
});
