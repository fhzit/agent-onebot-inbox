import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from './config.js';
import type { MessageStore } from './store.js';
import type { PostgresMessageStore } from './postgres-store.js';
import type { ContactsStore } from './postgres-contacts-store.js';
import type { PostgresAiAdvisoryStore } from './ai-advisory-store.js';
import type { ProviderFileRetriever } from './attachments/retrieval.js';
import type { AdditionalMcpHandlers } from './mcp-additional-tools.js';


export type McpAttachmentService = {
  allowedRoots: readonly string[];
  maxBytes: number;
  resolveAccount: (accountId: string) =>
    | { permission: string; retrieve: ProviderFileRetriever }
    | undefined
    | Promise<{ permission: string; retrieve: ProviderFileRetriever } | undefined>;
};

export interface McpService {
  server: McpServer;
  connectStdio(): Promise<void>;
  createHttpTransport(): StreamableHTTPServerTransport;
}

/**
 * Data tools are deliberately withheld until each transport can supply a
 * verified, request-bound account principal. HTTP bearer authentication alone
 * and a shared stdio process do not establish per-caller account entitlement.
 */
export function createMcpService(
  _config: AppConfig,
  _store: MessageStore | PostgresMessageStore,
  _contactSearch?: Pick<ContactsStore, 'search' | 'get'>,
  _attachments?: McpAttachmentService,
  _adminHandlers?: AdditionalMcpHandlers,
  _aiAdvisories?: { store: Pick<PostgresAiAdvisoryStore, 'list'>; allowedAccountIds: readonly string[] },
): McpService {
  const server = new McpServer({ name: 'agent-onebot-inbox', version: '0.1.0' });
  server.registerTool('service_info', {
    description: 'Return static service identity and version information.',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify({ service: 'agent-onebot-inbox', version: '0.1.0' }) }],
  }));
  server.registerTool('system_status', {
    description: 'Return static MCP capability availability and service health without account or message data.',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify({
      service: 'agent-onebot-inbox',
      version: '0.1.0',
      status: 'ok',
      capabilities: {
        account_data: false,
        message_data: false,
        contacts: false,
        attachments: false,
        administration: false,
      },
    }) }],
  }));
  // Explicit account IDs do not prove the connected caller's entitlement.
  // Keep account-specific tools unavailable until request-bound scope exists.

  // Account IDs from process environment are not caller authentication. Do not
  // register data tools until a verified transport principal is available.
  return {
    server,
    async connectStdio() {
      await server.connect(new StdioServerTransport());
    },
    createHttpTransport() {
      return new StreamableHTTPServerTransport() as unknown as import('@modelcontextprotocol/sdk/shared/transport.js').Transport & StreamableHTTPServerTransport;
    },
  };
}
