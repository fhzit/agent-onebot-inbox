import { loadConfig } from './config.js';
import { MessageStore } from './store.js';
import { createMcpService } from './mcp.js';

const service = createMcpService(loadConfig(), new MessageStore());
await service.connectStdio();
