import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RuntimeStore } from './postgres-store.js';

/** Register bounded backwards pagination around an explicit conversation anchor. */
export function registerConversationHistoryTool(server: McpServer, store: Pick<RuntimeStore, 'context'>): void {
  server.registerTool('conversation_history', {
    description: 'Fetch a bounded page of messages before an explicit anchor message in its conversation. Offset 0 returns the messages nearest the anchor; pages are returned in chronological order. The anchor itself is excluded.',
    inputSchema: {
      message_id: z.string().min(1),
      offset: z.number().int().nonnegative().max(99).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ message_id, offset = 0, limit = 50 }) => {
    // Store.context caps each side at 100; enforce the cap before asking for an expanded window.
    const boundedLimit = Math.min(limit, 100 - offset);
    if (boundedLimit < 1) return { content: [{ type: 'text', text: JSON.stringify({ messages: [], offset, limit: 0, has_more: false }) }] };
    const window = await store.context(message_id, offset + boundedLimit, 0);
    if (window.length === 0) return { content: [{ type: 'text', text: JSON.stringify({ messages: [], offset, limit: boundedLimit, has_more: false }) }] };
    const end = window.length - 1; // context's final item is the anchor
    const anchor = window[end]!;
    if (anchor.id !== message_id) return { content: [{ type: 'text', text: JSON.stringify({ messages: [], offset, limit: boundedLimit, has_more: false }) }] };
    const beforeAnchor = window.slice(0, end);
    const start = Math.max(0, beforeAnchor.length - offset - boundedLimit);
    const endExclusive = Math.max(0, beforeAnchor.length - offset);
    const page = beforeAnchor.slice(start, endExclusive);
    const hasMore = anchor.id === message_id && offset + boundedLimit < 100 && beforeAnchor.length >= offset + boundedLimit;
    return { content: [{ type: 'text', text: JSON.stringify({ messages: page, offset, limit: boundedLimit, has_more: hasMore }) }] };
  });
}
