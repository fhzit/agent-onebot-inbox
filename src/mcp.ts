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
import { registerInboxTools, type InboxMcpStore } from './mcp-inbox-tools.js';
import { registerContactsListTool } from './mcp-contacts-list.js';
import { registerContactsSearchTool } from './mcp-contacts-search.js';
import { registerGroupMembersTool } from './mcp-group-members.js';


export type McpAttachmentService = {
  allowedRoots: readonly string[];
  maxBytes: number;
  resolveAccount: (accountId: string) =>
    | { permission: string; retrieve: ProviderFileRetriever }
    | undefined
    | Promise<{ permission: string; retrieve: ProviderFileRetriever } | undefined>;
};

export interface McpService {
  /** Server instance owned by the stdio transport. */
  server: McpServer;
  connectStdio(): Promise<void>;
  /**
   * The SDK's stateless HTTP mode requires one McpServer per request; a single
   * server instance cannot be connected to a second transport while one is open.
   */
  createHttpSession(): { server: McpServer; transport: StreamableHTTPServerTransport };
}

/**
 * Data tools are withheld by default: the HTTP transport authenticates a shared
 * bearer token, which proves service access but not a per-caller account
 * entitlement. A single-operator deployment can opt in explicitly and scope the
 * tools to the accounts it configures.
 */
export type McpDataToolOptions = {
  store: InboxMcpStore;
  allowedAccountIds: readonly string[];
  contacts?: Pick<ContactsStore, 'get' | 'search'>;
};

export function createMcpService(
  _config: AppConfig,
  _store: MessageStore | PostgresMessageStore,
  _contactSearch?: Pick<ContactsStore, 'search' | 'get'>,
  _attachments?: McpAttachmentService,
  _adminHandlers?: AdditionalMcpHandlers,
  _aiAdvisories?: { store: Pick<PostgresAiAdvisoryStore, 'list'>; allowedAccountIds: readonly string[] },
  dataTools?: McpDataToolOptions,
): McpService {
  const buildServer = (): McpServer => {
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
          account_data: Boolean(dataTools),
          message_data: Boolean(dataTools),
          contacts: Boolean(dataTools?.contacts),
          attachments: false,
          administration: false,
        },
      }) }],
    }));
    // Explicit account IDs do not prove the connected caller's entitlement.
    // Opt-in data tools are scoped to the caller-configured account list instead.
    if (dataTools) {
      registerInboxTools(server, dataTools.store, dataTools.allowedAccountIds);
      if (dataTools.contacts) {
        registerContactsListTool(server, dataTools.contacts);
        registerGroupMembersTool(server, dataTools.contacts);
        registerContactsSearchTool(server, dataTools.contacts);
      }
    }
    return server;
  };

  const stdioServer = buildServer();
  return {
    server: stdioServer,
    async connectStdio() {
      await stdioServer.connect(new StdioServerTransport());
    },
    createHttpSession() {
      return {
        server: buildServer(),
        // No sessionIdGenerator: the SDK then runs in stateless mode.
        transport: new StreamableHTTPServerTransport(),
      };
    },
  };
}
