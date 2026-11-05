import Fastify from 'fastify';
import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { MessageStore } from './store.js';
import { PostgresMessageStore } from './postgres-store.js';
import { PostgresContactsStore } from './postgres-contacts-store.js';
import { createMcpService, type McpService } from './mcp.js';
import { safeTokenEqual } from './normalize.js';

const config = loadConfig();
if (!config.apiToken) throw new Error('API_TOKEN is required');

let pool: Pool | undefined;
let service: McpService;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
  const store = PostgresMessageStore.fromPool(pool);
  const contacts = new PostgresContactsStore(pool);
  // Same opt-in contract as the main server: no data tools unless MCP_DATA_TOOLS=1.
  const dataTools = process.env.MCP_DATA_TOOLS === '1'
    ? { store, allowedAccountIds: config.accounts.filter(account => account.enabled).map(account => account.id), contacts }
    : undefined;
  service = createMcpService(config, store, contacts, undefined, undefined, undefined, dataTools);
} else {
  service = createMcpService(config, new MessageStore());
}

const app = Fastify({ logger: false, bodyLimit: config.maxMessageBytes });
  app.post('/mcp', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeTokenEqual(config.apiToken, token)) return reply.code(401).send({ error: 'unauthorized' });
    const transport = service.createHttpTransport();
    await service.server.connect(transport as import('@modelcontextprotocol/sdk/shared/transport.js').Transport);
    transport.onerror = error => app.log.error(error);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    return reply;
  });
app.get('/health', async () => ({ status: 'ok' }));
await app.listen({ host: config.host, port: config.port });
const shutdown = async () => { await app.close(); await service.server.close(); await pool?.end(); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
