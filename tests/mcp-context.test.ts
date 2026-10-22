import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('MCP conversation context uses target message and before/after window', async () => {
  const config = loadConfig({ API_TOKEN: 'secret', ACCOUNTS_JSON: JSON.stringify([{ id: 'a', alias: 'A', self_id: '10', provider: 'napcat', access_token: 'transport' }]) });
  const store = new MessageStore();
  for (let i = 1; i <= 4; i++) store.insert(normalizeEvent('a', 'napcat', 't', { post_type: 'message', message_type: 'private', self_id: '10', user_id: '20', message_id: i, time: 1700000000 + i, message: `${i}` })!);
  const service = createMcpService(config, store);
  const tools = (service.server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text?: string }> }> }> })._registeredTools;
  const target = store.list('a', 10).find(m => m.external_message_id === '2')!;
  const result = await tools.conversation_context.handler({ message_id: target.id, before: 1, after: 1 });
  const messages = JSON.parse(result.content[0]!.text!) as Array<{ external_message_id: string }>;
  assert.deepEqual(messages.map(m => m.external_message_id), ['1', '2', '3']);
});
