import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NormalizedMessage } from './normalize.js';
import type {
  ConversationMessageQuery,
  ConversationMessageResult,
  ConversationQuery,
  ConversationQueryResult,
  InboxQuery,
  InboxQueryResult,
} from './store.js';

/** Read surface the inbox MCP tools require; satisfied by both memory and PostgreSQL stores. */
export type InboxMcpStore = {
  query(filters?: InboxQuery): Promise<InboxQueryResult> | InboxQueryResult;
  get(id: string): Promise<NormalizedMessage | undefined> | NormalizedMessage | undefined;
  conversations(filters?: ConversationQuery): Promise<ConversationQueryResult> | ConversationQueryResult;
  conversationMessages(conversationId: string, filters?: ConversationMessageQuery): Promise<ConversationMessageResult> | ConversationMessageResult;
};

/** Tool payloads are bounded so a single call cannot stream an unbounded history. */
const MAX_TEXT_CHARS = 2000;
const MAX_ACCOUNTS_PER_CALL = 5;
const MAX_LIMIT = 100;

const accountIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);
const timestampSchema = z.string().trim().min(1).max(64);

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

function compactMessage(message: NormalizedMessage) {
  const plain = typeof message.plain_text === 'string' ? message.plain_text : '';
  const truncated = plain.length > MAX_TEXT_CHARS;
  return {
    id: message.id,
    account_id: message.account_id,
    conversation_id: message.conversation_id,
    conversation_type: message.conversation_type,
    group_id: message.group_id ?? null,
    peer_user_id: message.peer_user_id ?? null,
    direction: message.direction,
    sender_id: message.sender_id,
    sender_name: message.sender_name || null,
    sent_at: message.sent_at,
    priority: message.priority,
    at_me: message.at_me === true,
    requires_reply: message.requires_reply === true,
    deadline: message.deadline ?? null,
    plain_text: truncated ? `${plain.slice(0, MAX_TEXT_CHARS)}…` : plain,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Account scope comes from the caller's configuration, never from tool input alone. */
export function createInboxAccountScope(allowedAccountIds: readonly string[]) {
  const allowed = new Set(allowedAccountIds.filter(id => typeof id === 'string' && id.trim() !== ''));
  return {
    ids: [...allowed],
    isAllowed(accountId: string): boolean { return allowed.has(accountId); },
    /** Conversation IDs are prefixed with their owning account (`<account>:<type>:<peer>`). */
    accountOfConversation(conversationId: string): string | undefined {
      const index = conversationId.indexOf(':');
      return index > 0 ? conversationId.slice(0, index) : undefined;
    },
  };
}

export type InboxAccountScope = ReturnType<typeof createInboxAccountScope>;

export function registerInboxTools(server: McpServer, store: InboxMcpStore, allowedAccountIds: readonly string[]): void {
  const scope = createInboxAccountScope(allowedAccountIds);

  async function queryScoped(filters: InboxQuery, requested?: string) {
    if (requested !== undefined) {
      if (!scope.isAllowed(requested)) throw new Error('Account is not authorized for this MCP caller');
      return store.query({ ...filters, account_id: requested });
    }
    const ids = scope.ids.slice(0, MAX_ACCOUNTS_PER_CALL);
    if (ids.length === 0) throw new Error('No authorized accounts are configured');
    const limit = filters.limit ?? 20;
    const perAccount = await Promise.all(ids.map(id => store.query({ ...filters, account_id: id, limit, offset: 0 })));
    const merged = perAccount.flatMap(result => result.messages).sort((a, b) => b.sent_at.localeCompare(a.sent_at) || b.id.localeCompare(a.id));
    const total = perAccount.reduce((sum, result) => sum + result.total, 0);
    return { messages: merged.slice(0, limit), total, offset: 0, limit, has_more: total > limit };
  }

  server.registerTool('inbox_query', {
    description: 'Read inbox messages for the authorized accounts, newest first. Supports account, conversation type, sender, time range, keyword, priority, at-me and agent-state filters. Read-only: never marks messages seen or touches QQ read state.',
    inputSchema: {
      account_id: accountIdSchema.optional(),
      type: z.enum(['private', 'group']).optional(),
      sender: z.string().trim().min(1).max(128).optional(),
      since: timestampSchema.optional(),
      until: timestampSchema.optional(),
      keyword: z.string().trim().min(1).max(200).optional(),
      priority: prioritySchema.optional(),
      at_me: z.boolean().optional(),
      state: z.enum(['unread', 'processed', 'dismissed']).optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      offset: z.number().int().nonnegative().max(10000).optional(),
    },
  }, async (input) => {
    try {
      const filters: InboxQuery = {
        ...(input.type ? { type: input.type } : {}),
        ...(input.sender ? { sender: input.sender } : {}),
        ...(input.since ? { since: input.since } : {}),
        ...(input.until ? { until: input.until } : {}),
        ...(input.keyword ? { keyword: input.keyword } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.at_me === undefined ? {} : { at_me: input.at_me }),
        ...(input.state ? { state: input.state } : {}),
        limit: input.limit ?? 20,
        ...(input.offset === undefined ? {} : { offset: input.offset }),
      };
      const result = await queryScoped(filters, input.account_id);
      return ok({
        total: result.total,
        count: result.messages.length,
        limit: result.limit,
        offset: result.offset,
        has_more: result.has_more,
        messages: result.messages.map(compactMessage),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Query failed');
    }
  });

  server.registerTool('conversations_list', {
    description: 'List aggregated conversations (one row per QQ chat) with last message preview and unread count, newest activity first. Read-only.',
    inputSchema: {
      account_id: accountIdSchema.optional(),
      type: z.enum(['private', 'group']).optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      offset: z.number().int().nonnegative().max(10000).optional(),
    },
  }, async (input) => {
    try {
      const filters: ConversationQuery = {
        ...(input.type ? { type: input.type } : {}),
        limit: input.limit ?? 20,
        ...(input.offset === undefined ? {} : { offset: input.offset }),
      };
      if (input.account_id !== undefined) {
        if (!scope.isAllowed(input.account_id)) throw new Error('Account is not authorized for this MCP caller');
        return ok(await store.conversations({ ...filters, account_id: input.account_id }));
      }
      const ids = scope.ids.slice(0, MAX_ACCOUNTS_PER_CALL);
      if (ids.length === 0) throw new Error('No authorized accounts are configured');
      const parts = await Promise.all(ids.map(id => store.conversations({ ...filters, account_id: id })));
      const conversations = parts.flatMap(part => part.conversations).sort((a, b) => b.last_at.localeCompare(a.last_at));
      const limit = filters.limit ?? 20;
      return ok({ conversations: conversations.slice(0, limit), limit, offset: filters.offset ?? 0 });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Query failed');
    }
  });

  server.registerTool('conversation_messages', {
    description: 'Read a bounded page of messages inside one conversation, newest first, using a before-cursor. Read-only.',
    inputSchema: {
      conversation_id: z.string().trim().min(1).max(256),
      account_id: accountIdSchema.optional(),
      before: timestampSchema.optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    },
  }, async (input) => {
    try {
      const owner = scope.accountOfConversation(input.conversation_id);
      if (owner !== undefined && !scope.isAllowed(owner)) throw new Error('Conversation is outside the authorized account scope');
      if (input.account_id !== undefined && !scope.isAllowed(input.account_id)) throw new Error('Account is not authorized for this MCP caller');
      const result = await store.conversationMessages(input.conversation_id, {
        ...(input.account_id ? { account_id: input.account_id } : {}),
        ...(input.before ? { before: input.before } : {}),
        limit: input.limit ?? 20,
      });
      return ok({
        conversation_id: result.conversation_id,
        has_more: result.has_more,
        count: result.messages.length,
        messages: result.messages.map(compactMessage),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Query failed');
    }
  });

  server.registerTool('message_get', {
    description: 'Read one message by ID, including its full stored text, priority and inbox state. Read-only.',
    inputSchema: { message_id: z.string().trim().min(1).max(256) },
  }, async ({ message_id }) => {
    try {
      const message = await store.get(message_id);
      if (!message) return fail('Message not found');
      if (!scope.isAllowed(message.account_id)) throw new Error('Message is outside the authorized account scope');
      return ok(compactMessage(message));
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Query failed');
    }
  });
}
