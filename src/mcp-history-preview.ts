import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RuntimeStore } from './postgres-store.js';

/** Register a read-only history preview fenced to an explicit account and conversation. */
export function registerHistoryPreviewTool(server: McpServer, store: Pick<RuntimeStore, 'get' | 'context'>): void {
  server.registerTool('conversation_history_preview', {
    description: 'Read-only bounded history preview around an anchor, requiring explicit account and conversation IDs. Returns only messages matching both scopes; does not mutate messages or inbox state.',
    inputSchema: {
      account_id: z.string().min(1),
      conversation_id: z.string().min(1),
      anchor_message_id: z.string().min(1),
      before: z.number().int().min(0).max(20).optional(),
      after: z.number().int().min(0).max(20).optional(),
    },
  }, async ({ account_id, conversation_id, anchor_message_id, before = 10, after = 5 }) => {
    const anchor = await store.get(anchor_message_id);
    if (!anchor || anchor.account_id !== account_id || anchor.conversation_id !== conversation_id) {
      return { content: [{ type: 'text', text: JSON.stringify({ messages: [], anchor_found: false }) }] };
    }
    const messages = await store.context(anchor_message_id, before, after);
    const scoped = messages.filter(message => message.account_id === account_id && message.conversation_id === conversation_id);
    return { content: [{ type: 'text', text: JSON.stringify({ messages: scoped, anchor_found: scoped.some(message => message.id === anchor_message_id), account_id, conversation_id }) }] };
  });
}
