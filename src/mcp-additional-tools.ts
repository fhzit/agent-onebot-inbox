import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AccountStore } from './account-store.js';
import type { ContactsStore } from './postgres-contacts-store.js';
import type { NotificationConfigStore } from './notification-settings.js';
import type { PostgresNotificationDeliveryStore } from './notification-delivery-store.js';

export interface AdditionalMcpStoreDependencies {
  accounts: Pick<AccountStore, 'list'>;
  contacts: Pick<ContactsStore, 'get'>;
  notifications: Pick<NotificationConfigStore, 'get'>;
  deliveries?: Pick<PostgresNotificationDeliveryStore, 'list'>;
}

/** Bind real read-only stores; every account lookup is validated against the managed account store. */
export function createAdditionalMcpHandlers(stores: AdditionalMcpStoreDependencies): AdditionalMcpHandlers {
  async function requireAccount(accountId: string) {
    const accounts = await stores.accounts.list();
    const account = accounts.find(item => item.id === accountId);
    if (!account) throw new Error('Unknown account');
    return account;
  }
  return {
    async contacts(accountId) {
      await requireAccount(accountId);
      const snapshot = await stores.contacts.get(accountId);
      return { friends: snapshot.friends, last_synced: { friends: snapshot.last_synced.friends } };
    },
    async groups(accountId) {
      await requireAccount(accountId);
      const snapshot = await stores.contacts.get(accountId);
      return { groups: snapshot.groups, last_synced: { groups: snapshot.last_synced.groups } };
    },
    async health(accountId) { return requireAccount(accountId); },
    async notificationStatus(accountId) {
      await requireAccount(accountId);
      const settings = await stores.notifications.get();
      const deliveries = stores.deliveries ? await stores.deliveries.list(20) : [];
      return {
        enabled: settings.enabled, minPriority: settings.minPriority,
        includePreview: settings.includePreview, includeContext: settings.includeContext, timeoutMs: settings.timeoutMs,
        maxAttempts: settings.maxAttempts, webhook_configured: Boolean(settings.webhookUrl),
        recent_deliveries: deliveries.filter(item => item.accountId === accountId).map(item => ({ event: item.event, outcome: item.outcome, httpStatus: item.httpStatus ?? null, createdAt: item.createdAt.toISOString() })),
      };
    },
  };
}

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
