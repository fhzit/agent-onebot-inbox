import { loadConfig } from './config.js';
import { productionRequiresDatabase } from './startup-policy.js';
import { startServer } from './server.js';

const config = loadConfig();
const requireDatabase = productionRequiresDatabase(process.env.NODE_ENV) || process.env.REQUIRE_DATABASE === 'true';
const runtime = await startServer(config, undefined, { rules: [], watchPeople: [] }, { requireDatabase, ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}), ...(process.env.ACCOUNT_ENCRYPTION_KEY ? { accountEncryptionKey: process.env.ACCOUNT_ENCRYPTION_KEY } : {}) });
const shutdown = async () => { await runtime.close(); process.exit(0); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
