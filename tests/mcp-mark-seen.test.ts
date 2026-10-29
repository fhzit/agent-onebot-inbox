import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('MCP mark_seen marks a message seen without processing and validates IDs', async () => {
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id: 'main', alias: 'Main', self_id: '100', provider: 'napcat', access_token: 'secret' }]), API_TOKEN: 'token' });
  const store = new MessageStore();
  const message = normalizeEvent('main', 'napcat', 'fixture', { post_type: 'message', message_type: 'private', self_id: '100', user_id: '200', message_id: 1, time: 1700000001, message: 'mark me seen' })!;
  store.insert(message);
  const mcp = createMcpService(config, store).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'mark_seen', arguments: { message_id: message.id } });
    assert.equal(result.isError, undefined);
    const state = JSON.parse((result.content as Array<{text:string}>)[0]!.text) as { unread:boolean; seen_by_agent:boolean; processed:boolean; qq_read:boolean };
    assert.equal(state.seen_by_agent, true);
    assert.equal(state.processed, false);
    assert.equal(state.unread, false);
    assert.equal(state.qq_read, false);
    const missing = await client.callTool({ name: 'mark_seen', arguments: { message_id: 'missing' } });
    assert.equal(missing.isError, true);
    const invalid = await client.callTool({ name: 'mark_seen', arguments: { message_id: '' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await mcp.close(); }
});
