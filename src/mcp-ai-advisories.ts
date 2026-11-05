import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AiAdvisoryRecord, PostgresAiAdvisoryStore } from './ai-advisory-store.js';

/** Register a read-only advisory metadata list fenced to an explicit account. */
export function registerAiAdvisoriesTool(server: McpServer, store: Pick<PostgresAiAdvisoryStore, 'list'>, allowedAccountIds: readonly string[]): void {
  server.registerTool('ai_advisories_list', {
    description: 'List bounded, persisted AI advisory metadata for one explicitly selected account. Does not return message text, reasoning, or secrets.',
    inputSchema: {
      account_id: z.string().min(1).max(128),
      limit: z.number().int().min(1).max(100).optional(),
      before_created_at: z.string().datetime({ offset: true }).optional(),
      before_message_id: z.string().min(1).max(128).optional(),
    },
  }, async ({ account_id, limit = 50, before_created_at, before_message_id }) => {
    if (!allowedAccountIds.includes(account_id)) {
      return { isError: true, content: [{ type: 'text', text: 'Account is not authorized for AI advisories' }] };
    }
    if ((before_created_at === undefined) !== (before_message_id === undefined)) {
      return { isError: true, content: [{ type: 'text', text: 'before_created_at and before_message_id must be supplied together' }] };
    }
    const page = before_created_at === undefined
      ? { limit }
      : { limit, before: before_created_at, beforeMessageId: before_message_id! };
    const records = await store.list(account_id, page);
    const advisories = records.map(toSafeMetadata);
    return { content: [{ type: 'text', text: JSON.stringify({ account_id, advisories }) }] };
  });
}

function toSafeMetadata(record: AiAdvisoryRecord) {
  return {
    account_id: record.accountId,
    message_id: record.messageId,
    label: record.label,
    confidence: record.confidence,
    model: record.model,
    policy_version: record.policyVersion,
    created_at: record.createdAt,
  };
}
