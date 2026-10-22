import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('MCP inbox search returns paginated filters shared with store query', async () => {
  const config = loadConfig({ API_TOKEN: 'secret', ACCOUNTS_JSON: JSON.stringify([{ id: 'a', alias: 'A', self_id: '10', provider: 'napcat', access_token: 'transport' }]) });
  const store = new MessageStore();
  for (let i = 1; i <= 3; i++) store.insert(normalizeEvent('a', 'napcat', 't', { post_type: 'message', message_type: 'private', self_id: '10', user_id: '20', message_id: i, time: 1700000000 + i, message: 'needle' })!);
  const service = createMcpService(config, store);
  const tools = (service.server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text?: string }> }> }> })._registeredTools;
  const result = await tools.inbox_search.handler({ query: 'needle', offset: 1, limit: 1 });
  const response = JSON.parse(result.content[0]!.text!) as { messages: Array<{ external_message_id: string }>; total: number; has_more: boolean };
  assert.equal(response.total, 3); assert.equal(response.has_more, true);
  assert.equal(response.messages.length, 1); assert.equal(response.messages[0]?.external_message_id, '2');
});
