import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RuntimeStore } from './postgres-store.js';
import type { ExtractedTask } from './task-extraction.js';

/** Register a read-only, bounded history tool for caller-side task extraction. */
export function registerTaskExtractionTool(server: McpServer, store: Pick<RuntimeStore, 'context'>): void {
  server.registerTool('extract_tasks_from_history', {
    description: 'Read a bounded conversation window around an explicit message anchor for task extraction. Does not invoke a model, create tasks, or change message state. Returns source messages and a strict output shape for caller-side extraction.',
    inputSchema: {
      message_id: z.string().min(1).max(256),
      before: z.number().int().min(0).max(50).optional(),
      after: z.number().int().min(0).max(50).optional(),
    },
  }, async ({ message_id, before = 20, after = 10 }) => {
    const messages = await store.context(message_id, before, after);
    const anchorPresent = messages.some(message => message.id === message_id);
    const result = {
      messages: anchorPresent ? messages : [],
      output_schema: {
        tasks: [{ title: 'string', owner: 'optional string', dueAt: 'optional ISO-8601 timestamp', evidence: 'optional exact supporting quote' } satisfies Record<keyof ExtractedTask, string>],
      },
      side_effects: false,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
}
