import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContactsStore } from './postgres-contacts-store.js';

/** Register a read-only contact snapshot tool requiring explicit account scope. */
export function registerContactsListTool(server: McpServer, contacts: Pick<ContactsStore, 'get'>): void {
  server.registerTool('contacts_list', {
    description: 'List the cached friends, groups, group members, and sync timestamps for one account.',
    inputSchema: { account_id: z.string().min(1) },
  }, async ({ account_id }) => ({
    content: [{ type: 'text', text: JSON.stringify(await contacts.get(account_id)) }],
  }));
}
