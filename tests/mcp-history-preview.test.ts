import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerHistoryPreviewTool } from '../src/mcp-history-preview.js';
import type { NormalizedMessage } from '../src/normalize.js';

function message(id: string, account_id: string, conversation_id: string): NormalizedMessage {
  return { id, account_id, conversation_id, provider_id: '', transport_id: '', direction: 'incoming', external_message_id: null, client_request_id: null, event_fingerprint: id, conversation_type: 'private', group_id: null, peer_user_id: 'peer', sender_id: 'peer', sender_name: null, sender_card: null, sent_at: '2024-01-01T00:00:00.000Z', received_at: '2024-01-01T00:00:00.000Z', plain_text: id, raw_message: id, segments: [], reply_to_message_id: null, at_users: [], at_me: false, at_all: false, priority: 'P4', priority_score: 0, requires_reply: false, urgent: false, deadline: null, raw_event: {} };
}

test('history preview requires matching explicit account/conversation and never mutates', async () => {
  const anchor = message('a', 'acct-1', 'conv-1');
  const rows = [message('prior', 'acct-1', 'conv-1'), anchor, message('foreign-account', 'acct-2', 'conv-1'), message('foreign-conversation', 'acct-1', 'conv-2')];
  let contextCalls = 0;
  const store = { get: (id: string) => rows.find(row => row.id === id), context: () => { contextCalls++; return rows; } };
  const server = new McpServer({ name: 'test', version: '1' });
  registerHistoryPreviewTool(server, store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'conversation_history_preview', arguments: { account_id: 'acct-1', conversation_id: 'conv-1', anchor_message_id: 'a' } });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.deepEqual(data.messages.map((row: NormalizedMessage) => row.id), ['prior', 'a']);
    assert.equal(data.anchor_found, true);
    assert.equal(contextCalls, 1);
    const wrong = await client.callTool({ name: 'conversation_history_preview', arguments: { account_id: 'acct-2', conversation_id: 'conv-1', anchor_message_id: 'a' } });
    assert.deepEqual(JSON.parse((wrong.content as Array<{ text: string }>)[0]!.text), { messages: [], anchor_found: false });
    assert.equal(contextCalls, 1);
  } finally { await client.close(); await server.close(); }
});

test('history preview schema requires explicit nonempty scope and bounds context', async () => {
  const server = new McpServer({ name: 'test', version: '1' });
  registerHistoryPreviewTool(server, { get: () => undefined, context: () => [] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const emptyScope = await client.callTool({ name: 'conversation_history_preview', arguments: { account_id: '', conversation_id: 'c', anchor_message_id: 'a' } });
    assert.equal(emptyScope.isError, true);
    const oversized = await client.callTool({ name: 'conversation_history_preview', arguments: { account_id: 'x', conversation_id: 'c', anchor_message_id: 'a', before: 21 } });
    assert.equal(oversized.isError, true);
  } finally { await client.close(); await server.close(); }
});
