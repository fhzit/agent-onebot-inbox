import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { authorizedMcpAccountIds } from '../src/mcp-account-authorization.js';
import { registerAiAdvisoriesTool } from '../src/mcp-ai-advisories.js';

/**
 * Contract gap: principal entitlements are computed by the authorization helper,
 * but the advisory tool accepts only an already-materialized account-ID list.
 * These tests intentionally exercise the two APIs separately; they do not imply
 * a production principal-to-tool wiring exists.
 */
test('principal entitlement helper returns the enabled accounts for that principal', () => {
  assert.deepEqual(authorizedMcpAccountIds(
    { sub: 'user-1', accountIds: ['acct-1', 'acct-disabled', 'acct-foreign'] },
    [
      { id: 'acct-1', enabled: true },
      { id: 'acct-disabled', enabled: false },
      { id: 'acct-foreign', enabled: true },
    ],
  ), ['acct-1', 'acct-foreign']);
});

test('advisory tool enforces only the allowlist passed at registration; no principal bridge is present', async () => {
  const queried: string[] = [];
  const server = new McpServer({ name: 'authorization-bridge-contract', version: '1' });
  // This is the tool's current contract: allowedAccountIds, not a principal.
  registerAiAdvisoriesTool(server, {
    async list(accountId) { queried.push(accountId); return []; },
  }, ['acct-1']);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const authorized = await client.callTool({ name: 'ai_advisories_list', arguments: { account_id: 'acct-1' } });
    assert.equal(authorized.isError, undefined);

    const denied = await client.callTool({ name: 'ai_advisories_list', arguments: { account_id: 'acct-2' } });
    assert.equal(denied.isError, true);
    assert.match((denied.content as Array<{ text: string }>)[0]!.text, /not authorized/);
    assert.deepEqual(queried, ['acct-1']);
  } finally {
    await client.close();
    await server.close();
  }
});
