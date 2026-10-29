import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import type { AppConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

const config = (port: number): AppConfig => ({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, adminBasePath: '/admin', accounts: [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'readonly' }] });
function stubPool(run: (sql: string) => unknown) {
  const original = { query: Pool.prototype.query, connect: Pool.prototype.connect, end: Pool.prototype.end };
  const calls: { sql: string; values: unknown[] }[] = [];
  const execute = (statement: string, values: unknown[] = []) => { calls.push({ sql: statement, values }); return Promise.resolve(run(statement)); };
  Pool.prototype.query = function(text: string | { text: string }, values?: unknown[]) { return execute(typeof text === 'string' ? text : text.text, values) as never; };
  Pool.prototype.connect = function() { return Promise.resolve({ query: (text: string, values: unknown[] = []) => execute(text, values), release() {} }) as never; };
  Pool.prototype.end = function() { return Promise.resolve() as never; };
  return { calls, restore() { Pool.prototype.query = original.query; Pool.prototype.connect = original.connect; Pool.prototype.end = original.end; } };
}

test('history reconciliation API is authenticated, read-only, database-local, and returns global counts', async () => {
  const db = stubPool(sql => sql.includes('FROM schema_migrations') ? { rows: [{ ok: 1 }], rowCount: 1 } : sql.includes('FROM messages WHERE direction') ? { rows: [{ incoming_messages: '12', queued_notifications: '10', missing_notification_rows: '2' }], rowCount: 1 } : { rows: [], rowCount: 1 });
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer(config(32917), undefined, { rules: [], watchPeople: [] }, { databaseUrl: 'postgres://test', accountEncryptionKey: Buffer.alloc(32, 7).toString('base64') });
    const url = `http://127.0.0.1:${runtime.address()!.port}/api/admin/history-reconciliation-audit`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mode: 'read_only_local_audit', providerHistoryAvailable: false, incomingMessages: 12, queuedNotifications: 10, missingNotificationRows: 2, scope: 'database_local_state_only' });
    const queries = db.calls.filter(call => call.sql.includes('FROM messages WHERE direction'));
    assert.equal(queries.length, 1);
    assert.doesNotMatch(queries[0]!.sql, /INSERT|UPDATE|DELETE/i);
    assert.deepEqual(queries[0]!.values, []);
  } finally { if (runtime) await runtime.close(); db.restore(); }
});

test('history reconciliation API returns 503 when the database audit query fails', async () => {
  const db = stubPool(sql => { if (sql.includes('FROM schema_migrations')) return { rows: [{ ok: 1 }], rowCount: 1 }; if (sql.includes('FROM messages WHERE direction')) throw new Error('database unavailable'); return { rows: [], rowCount: 1 }; });
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer(config(32918), undefined, { rules: [], watchPeople: [] }, { databaseUrl: 'postgres://test', accountEncryptionKey: Buffer.alloc(32, 6).toString('base64') });
    const response = await fetch(`http://127.0.0.1:${runtime.address()!.port}/api/admin/history-reconciliation-audit`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'AUDIT_UNAVAILABLE', message: 'Local consistency audit could not read the database', retryable: true } });
  } finally { if (runtime) await runtime.close(); db.restore(); }
});

test('history reconciliation API returns 503 when no database is configured', async () => {
  const runtime = await startServer(config(32919));
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.address()!.port}/api/admin/history-reconciliation-audit`, { headers: { authorization: 'Bearer api-secret' } });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'AUDIT_UNAVAILABLE');
  } finally { await runtime.close(); }
});
