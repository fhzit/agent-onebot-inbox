import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContactsStore } from './postgres-contacts-store.js';

/** Register a bounded, read-only member listing from the local contacts snapshot. */
export function registerGroupMembersTool(server: McpServer, contacts: Pick<ContactsStore, 'get'>): void {
  server.registerTool('group_members', {
    description: 'List cached members of one group in an explicit account, with bounded pagination. Reads local synchronized contacts only; does not call the provider.',
    inputSchema: {
      account_id: z.string().min(1),
      group_id: z.string().min(1),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ account_id, group_id, offset = 0, limit = 50 }) => {
    const snapshot = await contacts.get(account_id);
    const group = snapshot.members.find(item => item.group_id === group_id);
    const members = group?.members ?? [];
    return { content: [{ type: 'text', text: JSON.stringify({ account_id, group_id, members: members.slice(offset, offset + limit), offset, limit, total: members.length }) }] };
  });
}
