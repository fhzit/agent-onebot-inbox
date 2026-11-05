import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpService } from '../src/mcp.js';
import { registerInboxTools } from '../src/mcp-inbox-tools.js';
import type { AppConfig } from '../src/config.js';

type Tool = { handler: (args: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }> };
const toolOf = (server: McpServer, name: string): Tool =>
  (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
const toolNames = (server: McpServer): string[] =>
  Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);

const message = (overrides: Record<string, unknown>) => ({
  id: 'm-1',
  account_id: 'acct-a',
  conversation_id: 'acct-a:group:100',
  conversation_type: 'group',
  group_id: '100',
  peer_user_id: null,
  direction: 'incoming',
  sender_id: '2002',
  sender_name: '小明',
  sender_card: '',
  sent_at: '2026-11-05T10:00:00.000Z',
  received_at: '2026-11-05T10:00:01.000Z',
  plain_text: 'hello',
  priority: 'P3',
  at_me: false,
  requires_reply: false,
  deadline: null,
  ...overrides,
});

function fakeStore(messages: Array<ReturnType<typeof message>>) {
  const calls: string[] = [];
  return {
    calls,
    async query(filters: Record<string, unknown> = {}) {
      calls.push(`query:${String(filters.account_id ?? '*')}`);
      const matching = messages
        .filter(item => !filters.account_id || item.account_id === filters.account_id)
        .sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      const limit = Math.min(Number(filters.limit ?? 50), 200);
      return { messages: matching.slice(0, limit), total: matching.length, offset: 0, limit, has_more: matching.length > limit };
    },
    async get(id: string) {
      return messages.find(item => item.id === id);
    },
    async conversations(filters: Record<string, unknown> = {}) {
      calls.push(`conversations:${String(filters.account_id ?? '*')}`);
      const rows = messages
        .filter(item => !filters.account_id || item.account_id === filters.account_id)
        .map(item => ({
          conversation_id: item.conversation_id, account_id: item.account_id, type: 'group', group_id: item.group_id,
          peer_user_id: null, title: null,
          last_message: { id: item.id, plain_text: item.plain_text, sender_id: item.sender_id, sender_name: item.sender_name, sent_at: item.sent_at, priority: item.priority, direction: item.direction },
          message_count: 1, unread_count: 1, last_at: item.sent_at,
        }));
      return { conversations: rows, total: rows.length, offset: 0, limit: 20, has_more: false };
    },
    async conversationMessages(conversationId: string) {
      const rows = messages.filter(item => item.conversation_id === conversationId);
      return { conversation_id: conversationId, messages: rows, has_more: false };
    },
  };
}

test('inbox_query merges every authorized account, newest first, and bounds the page', async () => {
  const store = fakeStore([
    message({ id: 'a-old', sent_at: '2026-11-05T09:00:00.000Z' }),
    message({ id: 'a-new', sent_at: '2026-11-05T11:00:00.000Z' }),
    message({ id: 'b-new', account_id: 'acct-b', conversation_id: 'acct-b:private:3003', sent_at: '2026-11-05T12:00:00.000Z' }),
  ]);
  const server = new McpServer({ name: 'test', version: '1' });
  registerInboxTools(server, store as never, ['acct-a', 'acct-b']);
  const response = await toolOf(server, 'inbox_query').handler({ limit: 2 });
  const payload = JSON.parse(response.content[0]!.text!);
  assert.deepEqual(payload.messages.map((item: { id: string }) => item.id), ['b-new', 'a-new']);
  assert.equal(payload.total, 3);
  assert.equal(payload.has_more, true);
  assert.deepEqual(store.calls.sort(), ['query:acct-a', 'query:acct-b']);
});

test('inbox_query rejects an account the caller is not authorized for', async () => {
  const store = fakeStore([message({})]);
  const server = new McpServer({ name: 'test', version: '1' });
  registerInboxTools(server, store as never, ['acct-a']);
  const response = await toolOf(server, 'inbox_query').handler({ account_id: 'acct-z' });
  assert.equal(response.isError, true);
  assert.equal(store.calls.length, 0);
});

test('conversation_messages refuses a conversation owned by another account', async () => {
  const store = fakeStore([message({})]);
  const server = new McpServer({ name: 'test', version: '1' });
  registerInboxTools(server, store as never, ['acct-a']);
  const response = await toolOf(server, 'conversation_messages').handler({ conversation_id: 'acct-b:group:100' });
  assert.equal(response.isError, true);
});

test('message_get refuses a message from an unauthorized account', async () => {
  const store = fakeStore([message({ id: 'other', account_id: 'acct-b', conversation_id: 'acct-b:group:100' })]);
  const server = new McpServer({ name: 'test', version: '1' });
  registerInboxTools(server, store as never, ['acct-a']);
  const response = await toolOf(server, 'message_get').handler({ message_id: 'other' });
  assert.equal(response.isError, true);
});

test('MCP service keeps data tools off unless an explicit scope is supplied', () => {
  const config = { accounts: [{ id: 'acct-a', enabled: true }] } as unknown as AppConfig;
  const store = fakeStore([message({})]);
  const disabled = createMcpService(config, store as never);
  assert.deepEqual(toolNames(disabled.server).sort(), ['service_info', 'system_status']);
  const enabled = createMcpService(config, store as never, undefined, undefined, undefined, undefined, {
    store: store as never,
    allowedAccountIds: ['acct-a'],
  });
  const names = toolNames(enabled.server);
  for (const expected of ['inbox_query', 'conversations_list', 'conversation_messages', 'message_get']) {
    assert.ok(names.includes(expected), `${expected} registered`);
  }
});
