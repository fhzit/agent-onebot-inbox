import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

function seed(count: number) {
  const store = new MessageStore();
  for (let n = 1; n <= count; n++) {
    store.insert(normalizeEvent('main', 'napcat', `event-${n}`, { post_type: 'message', message_type: 'private', self_id: '100', user_id: '200', message_id: n, time: 1700000000 + n, message: `msg-${n}` })!);
  }
  return store;
}

test('conversation_history pages backwards from anchor in chronological order', async () => {
  const store = seed(8);
  const messages = store.query({ limit: 8 }).messages;
  const anchor = messages.find(m => m.plain_text === 'msg-6')!;
  const service = createMcpService(loadConfig({ ACCOUNTS_JSON: '[]', API_TOKEN: 'token' }), store).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'history-test', version: '1' });
  await Promise.all([service.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const first = await client.callTool({ name: 'conversation_history', arguments: { message_id: anchor.id, limit: 2 } });
    const firstData = JSON.parse((first.content as Array<{text:string}>)[0]!.text);
    assert.deepEqual(firstData.messages.map((m: {plain_text:string}) => m.plain_text), ['msg-4', 'msg-5']);
    assert.equal(firstData.has_more, true);
    const second = await client.callTool({ name: 'conversation_history', arguments: { message_id: anchor.id, offset: 2, limit: 2 } });
    const secondData = JSON.parse((second.content as Array<{text:string}>)[0]!.text);
    assert.deepEqual(secondData.messages.map((m: {plain_text:string}) => m.plain_text), ['msg-2', 'msg-3']);
  } finally { await client.close(); await service.close(); }
});

test('conversation_history rejects offsets beyond bounded context', async () => {
  const store = seed(2);
  const anchor = store.query({ limit: 1 }).messages[0]!;
  const service = createMcpService(loadConfig({ ACCOUNTS_JSON: '[]', API_TOKEN: 'token' }), store).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'history-test', version: '1' });
  await Promise.all([service.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'conversation_history', arguments: { message_id: anchor.id, offset: 99, limit: 10 } });
    const data = JSON.parse((result.content as Array<{text:string}>)[0]!.text);
    assert.deepEqual(data, { messages: [], offset: 99, limit: 1, has_more: false });
  } finally { await client.close(); await service.close(); }
});
