import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('MCP inbox list and search support bounded unread/processed/dismissed state filters', async () => {
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id: 'main', alias: 'Main', self_id: '100', provider: 'napcat', access_token: 'secret' }]), API_TOKEN: 'token' });
  const store = new MessageStore();
  const add = (id: number, text: string) => store.insert(normalizeEvent('main', 'napcat', 'fixture', { post_type: 'message', message_type: 'private', self_id: '100', user_id: String(200 + id), message_id: id, time: 1700000000 + id, message: text })!);
  add(1, 'unread needle');
  add(2, 'processed needle');
  add(3, 'dismissed needle');
  store.markProcessed(store.query({ keyword: 'processed needle' }).messages[0]!.id);
  store.dismiss(store.query({ keyword: 'dismissed needle' }).messages[0]!.id);
  const mcp = createMcpService(config, store).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  try {
    for (const [state, text] of [['unread', 'unread needle'], ['processed', 'processed needle'], ['dismissed', 'dismissed needle']] as const) {
      const listed = await client.callTool({ name: 'inbox_list', arguments: { state, limit: 1 } });
      const listedPayload = JSON.parse((listed.content as Array<{text:string}>)[0]!.text) as {messages:Array<{plain_text:string}>;total:number};
      assert.equal(listedPayload.total, 1);
      assert.equal(listedPayload.messages[0]?.plain_text, text);
      const searched = await client.callTool({ name: 'inbox_search', arguments: { query: text, state } });
      const searchedPayload = JSON.parse((searched.content as Array<{text:string}>)[0]!.text) as {messages:Array<{plain_text:string}>;total:number};
      assert.equal(searchedPayload.total, 1);
      assert.equal(searchedPayload.messages[0]?.plain_text, text);
    }
    const invalid = await client.callTool({ name: 'inbox_list', arguments: { state: 'all' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await mcp.close(); }
});
