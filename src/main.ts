import { loadConfig } from './config.js';
import { startServer } from './server.js';

const config = loadConfig();
const requireDatabase = process.env.NODE_ENV === 'production' || process.env.REQUIRE_DATABASE === 'true';
const runtime = await startServer(config, undefined, { rules: [], watchPeople: [] }, { requireDatabase, ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}) });
const shutdown = async () => { await runtime.close(); process.exit(0); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
