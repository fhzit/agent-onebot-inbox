import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpService } from '../src/mcp.js';
import type { AppConfig } from '../src/config.js';

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1', account_id: 'acct-a', conversation_id: 'acct-a:group:100', conversation_type: 'group',
  group_id: '100', peer_user_id: null, direction: 'incoming', sender_id: '2002', sender_name: '小明',
  sender_card: '', sent_at: '2026-11-05T10:00:00.000Z', received_at: '2026-11-05T10:00:01.000Z',
  plain_text: 'hello', priority: 'P3', at_me: false, requires_reply: false, deadline: null, ...overrides,
});

const store = {
  async query() { return { messages: [message()], total: 1, offset: 0, limit: 20, has_more: false }; },
  async get(id: string) { return id === 'm-1' ? message() : undefined; },
  async conversations() {
    return { conversations: [{ conversation_id: 'acct-a:group:100', account_id: 'acct-a', type: 'group', group_id: '100', peer_user_id: null, title: null, last_message: { id: 'm-1', plain_text: 'hello', sender_id: '2002', sender_name: '小明', sent_at: '2026-11-05T10:00:00.000Z', priority: 'P3', direction: 'incoming' }, message_count: 1, unread_count: 1, last_at: '2026-11-05T10:00:00.000Z' }], total: 1, offset: 0, limit: 20, has_more: false };
  },
  async conversationMessages(id: string) { return { conversation_id: id, messages: [message()], has_more: false }; },
};

test('stateless HTTP MCP answers initialize, tools/list and tools/call across separate POSTs', async () => {
  const config = { accounts: [{ id: 'acct-a', enabled: true }] } as unknown as AppConfig;
  const service = createMcpService(config, store as never, undefined, undefined, undefined, undefined, {
    store: store as never,
    allowedAccountIds: ['acct-a'],
  });
  const http = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') { res.statusCode = 404; res.end(); return; }
    const { server, transport } = service.createHttpSession();
    res.once('close', () => { void transport.close().catch(() => {}); });
    void server.connect(transport as never).then(() => transport.handleRequest(req, res)).catch(() => {
      if (!res.headersSent) { res.statusCode = 500; res.end(); }
    });
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  try {
    // A populated header mirrors the deployment, where the bearer token is checked before this point.
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'inbox_query'), 'inbox_query discovered');
    const result = await client.callTool({ name: 'inbox_query', arguments: { limit: 1 } });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.equal(payload.total, 1);
    assert.equal(payload.messages[0].id, 'm-1');
    const single = await client.callTool({ name: 'message_get', arguments: { message_id: 'm-1' } });
    assert.equal(JSON.parse((single.content as Array<{ text: string }>)[0]!.text).id, 'm-1');
  } finally {
    await client.close();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
