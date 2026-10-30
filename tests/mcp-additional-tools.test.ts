import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAdditionalMcpTools } from '../src/mcp-additional-tools.js';

async function setup() {
  const server = new McpServer({ name: 'test', version: '1' });
  const seen: string[] = [];
  const handler = async (id: string) => { seen.push(id); return { account: id, status: 'ok', webhookSecret: 'do-not-return', nested: { apiToken: 'also-secret' } }; };
  registerAdditionalMcpTools(server, { contacts: handler, groups: handler, health: handler, notificationStatus: handler });
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

test('handler errors return a generic error without leaking details', async () => {
  const server = new McpServer({ name: 'test', version: '1' });
  registerAdditionalMcpTools(server, { contacts: async () => { throw new Error('secret token value'); }, groups: async () => null, health: async () => null, notificationStatus: async () => null });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const result = await client.callTool({ name: 'admin_contacts', arguments: { account_id: 'a' } });
  assert.equal(result.isError, true);
  assert.equal((result.content as Array<{ text: string }>)[0]!.text, 'Unable to read account status');
  await client.close();
});
