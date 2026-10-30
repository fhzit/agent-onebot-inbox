import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Read-only handlers deliberately return already-redacted, safe summaries. */
export interface AdditionalMcpHandlers {
  contacts: (accountId: string) => unknown | Promise<unknown>;
  groups: (accountId: string) => unknown | Promise<unknown>;
  health: (accountId: string) => unknown | Promise<unknown>;
  notificationStatus: (accountId: string) => unknown | Promise<unknown>;
}

const accountSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const safeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(safeJson);
  if (!value || typeof value !== 'object') return value;
  const secretKey = /secret|token|password|credential|authorization|webhook.?url|private.?key/i;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).map(([key, item]) => [key, safeJson(item)]));
};

/** Register explicit-account, read-only operational tools. */
export function registerAdditionalMcpTools(server: McpServer, handlers: AdditionalMcpHandlers): void {
  const tools = [
    ['admin_contacts', 'Read contacts summary for an explicit account.', handlers.contacts],
    ['admin_groups', 'Read groups summary for an explicit account.', handlers.groups],
    ['admin_health', 'Read health summary for an explicit account.', handlers.health],
    ['admin_notification_status', 'Read notification delivery status for an explicit account without exposing configuration secrets.', handlers.notificationStatus],
  ] as const;
  for (const [name, description, handler] of tools) {
    server.registerTool(name, { description, inputSchema: { account_id: accountSchema } }, async ({ account_id }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(safeJson(await handler(account_id))) }] };
      } catch {
        return { content: [{ type: 'text', text: 'Unable to read account status' }], isError: true };
      }
    });
  }
}
