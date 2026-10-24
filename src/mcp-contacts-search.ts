import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContactsStore } from './postgres-contacts-store.js';

/** Register the account-scoped contact search adapter on an MCP server. */
export function registerContactsSearchTool(server: McpServer, contacts: Pick<ContactsStore, 'search'>): void {
  server.registerTool('contacts_search', {
    description: 'Search cached contacts for one configured account by exact QQ ID, nickname, remark, or group card.',
    inputSchema: { account_id: z.string().min(1), query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
  }, async ({ account_id, query, limit }) => ({
    content: [{ type: 'text', text: JSON.stringify(await contacts.search(account_id, query, limit)) }],
  }));
}
