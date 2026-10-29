import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTaskExtractionTool } from '../src/mcp-task-extraction.js';

const history = [
  { id: 'before', plain_text: 'Could you send the report?', kind: 'message' },
  { id: 'anchor', plain_text: 'I will send it tomorrow.', kind: 'message' },
  { id: 'after', plain_text: 'Thanks', kind: 'message' },
];

test('extract task history tool returns bounded context and explicit no-side-effects contract', async () => {
  const requests: unknown[][] = [];
  const server = new McpServer({ name: 'test', version: '1' });
  registerTaskExtractionTool(server, { context: async (...args: unknown[]) => { requests.push(args); return history as never; } } as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'extract_tasks_from_history', arguments: { message_id: 'anchor', before: 1, after: 1 } });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.deepEqual(requests, [['anchor', 1, 1]]);
    assert.deepEqual(data.messages, history);
    assert.equal(data.side_effects, false);
    assert.deepEqual(Object.keys(data.output_schema), ['tasks']);
    assert.deepEqual(data.output_schema.tasks[0], { title: 'string', owner: 'optional string', dueAt: 'optional ISO-8601 timestamp', evidence: 'optional exact supporting quote' });
  } finally { await client.close(); await server.close(); }
});

test('task history tool returns no messages if anchor is absent', async () => {
  const server = new McpServer({ name: 'test', version: '1' });
  registerTaskExtractionTool(server, { context: async () => history as never } as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'extract_tasks_from_history', arguments: { message_id: 'missing' } });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.deepEqual(data.messages, []);
    assert.equal(data.side_effects, false);
  } finally { await client.close(); await server.close(); }
});
