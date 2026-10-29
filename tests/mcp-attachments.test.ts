import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpService } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('MCP message_attachments returns stored attachment references without fetching provider data', async () => {
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id: 'main', alias: 'Main', self_id: '100', provider: 'napcat', access_token: 'secret' }]), API_TOKEN: 'token' });
  const store = new MessageStore();
  const message = normalizeEvent('main', 'napcat', 'fixture', { post_type: 'message', message_type: 'private', self_id: '100', user_id: '200', message_id: 1, time: 1700000000, message: [{ type: 'file', data: { file: '/cache/report.pdf', file_id: 'file-1' } }] })!;
  store.insert(message);
  const mcp = createMcpService(config, store).server;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'message_attachments', arguments: { message_id: message.id } });
    assert.deepEqual(JSON.parse((result.content as Array<{text:string}>)[0]!.text), [
      { type: 'file', filename: 'report.pdf', provider_file_id: 'file-1', remote_reference: '/cache/report.pdf' },
    ]);
    const missing = await client.callTool({ name: 'message_attachments', arguments: { message_id: 'missing' } });
    assert.equal(missing.isError, true);
  } finally { await client.close(); await mcp.close(); }
});


test('MCP get_attachment retrieves bounded files and enforces account and root policy', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aoi-mcp-attachments-'));
  const allowed = path.join(root, 'allowed'); await mkdir(allowed);
  const file = path.join(allowed, 'report.txt'); await writeFile(file, 'safe payload');
  const config = loadConfig({ ACCOUNTS_JSON: JSON.stringify([{ id: 'direct', alias: 'Direct', self_id: '100', provider: 'napcat', access_token: 'secret' }]), API_TOKEN: 'token' });
  const service = (roots: string[], permission = 'direct') => createMcpService(config, new MessageStore(), undefined, { allowedRoots: roots, maxBytes: 100, resolveAccount: id => id === 'direct' ? { permission, retrieve: async () => file } : undefined }).server;
  async function invoke(server: ReturnType<typeof service>) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try { return await client.callTool({ name: 'get_attachment', arguments: { account_id: 'direct', file_id: 'provider-file-1' } }); }
    finally { await client.close(); await server.close(); }
  }
  try {
    const result = await invoke(service([allowed]));
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse((result.content as Array<{text:string}>)[0]!.text), { filename: 'report.txt', size: 12, content_type: 'application/octet-stream', data_base64: Buffer.from('safe payload').toString('base64') });
    assert.equal((await invoke(service([]))).isError, true);
    assert.equal((await invoke(service([allowed], 'readonly'))).isError, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
