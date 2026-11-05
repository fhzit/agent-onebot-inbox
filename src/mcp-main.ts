import { Pool } from 'pg';
import { loadConfig, type AppConfig } from './config.js';
import { PostgresMessageStore } from './postgres-store.js';
import { MessageStore } from './store.js';
import { createMcpService } from './mcp.js';
import { MemoryAccountStore, PostgresAccountStore } from './account-store.js';
import { PostgresContactsStore } from './postgres-contacts-store.js';
import { MemoryNotificationConfigStore, PostgresNotificationConfigStore } from './notification-settings.js';
import { PostgresNotificationDeliveryStore } from './notification-delivery-store.js';
import { createAdditionalMcpHandlers } from './mcp-additional-tools.js';
import type { ContactsStore } from './postgres-contacts-store.js';
import type { NotificationConfigStore } from './notification-settings.js';
import type { AccountStore } from './account-store.js';
import type { Pool as PgPool } from 'pg';

export async function createStdioMcpService(config: AppConfig, dependencies: {
  store?: MessageStore | PostgresMessageStore;
  accounts?: Pick<AccountStore, 'list'>;
  contacts?: Pick<ContactsStore, 'get'>;
  notifications?: Pick<NotificationConfigStore, 'get'>;
  deliveries?: Pick<PostgresNotificationDeliveryStore, 'list'>;
} = {}) {
  let accounts = dependencies.accounts;
  if (!accounts) {
    const memory = new MemoryAccountStore();
    for (const account of config.accounts) await memory.create(account);
    accounts = memory;
  }
  const contacts = dependencies.contacts ?? { async get() { return { friends: [], groups: [], members: [], last_synced: { friends: null, groups: null, members: {} } }; } };
  return createMcpService(config, dependencies.store ?? new MessageStore(), undefined, undefined,
    createAdditionalMcpHandlers({ accounts, contacts, notifications: dependencies.notifications ?? new MemoryNotificationConfigStore(), ...(dependencies.deliveries ? { deliveries: dependencies.deliveries } : {}) }));
}

export async function startStdioMcpServer(): Promise<void> {
  const config = loadConfig();
  const databaseUrl = process.env.DATABASE_URL;
  let pool: PgPool | undefined;
  let service: ReturnType<typeof createMcpService>;
  if (databaseUrl) {
    const encryptionKey = process.env.ACCOUNT_ENCRYPTION_KEY;
    if (!encryptionKey) throw new Error('ACCOUNT_ENCRYPTION_KEY is required for persistent MCP stores');
    pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
    const accountStore = new PostgresAccountStore(pool, encryptionKey);
    const contacts = new PostgresContactsStore(pool);
    const messageStore = PostgresMessageStore.fromPool(pool);
    const dataTools = process.env.MCP_DATA_TOOLS === '1'
      ? { store: messageStore, allowedAccountIds: config.accounts.filter(account => account.enabled).map(account => account.id), contacts }
      : undefined;
    service = createMcpService(config, messageStore, undefined, undefined, createAdditionalMcpHandlers({
      accounts: accountStore,
      contacts,
      notifications: new PostgresNotificationConfigStore(pool, encryptionKey),
      deliveries: new PostgresNotificationDeliveryStore(pool),
    }), undefined, dataTools);
  } else {
    service = await createStdioMcpService(config);
  }
  try { await service.connectStdio(); } finally { await pool?.end(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await startStdioMcpServer();
}
