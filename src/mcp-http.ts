import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { MessageStore } from './store.js';
import { createMcpService } from './mcp.js';
import { safeTokenEqual } from './normalize.js';

const config = loadConfig();
if (!config.apiToken) throw new Error('API_TOKEN is required');
const service = createMcpService(config, new MessageStore());
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
const shutdown = async () => { await app.close(); await service.server.close(); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
