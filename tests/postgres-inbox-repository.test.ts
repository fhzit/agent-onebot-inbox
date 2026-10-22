import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import { normalizeEvent } from '../src/normalize.js';

const message = normalizeEvent('main', 'napcat', 'ws', { post_type: 'message', message_type: 'private', self_id: '1', user_id: '2', message_id: 3, time: 1700000000, message: 'hello' })!;

test('Postgres repository persists state updates and computes inbox state', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const db: SqlClient = { async query(text, values) { calls.push({ text, values }); if (text.includes('FROM messages m')) return { rows: [{ ...message, seen_by_agent: true, processed: true, dismissed: false }] }; return { rows: [{ seen_by_agent: true, processed: true, dismissed: false }] }; } };
  const store = new PostgresMessageStore(db);
  assert.deepEqual(await store.markProcessed(message.id), { unread: false, seen_by_agent: true, processed: true, dismissed: false, qq_read: false });
  assert.match(calls[0]!.text, /INSERT INTO inbox_states/);
  assert.equal(calls[0]!.values?.[0], message.id);
});

test('Postgres inbox query uses parameterized filters and paginates result', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const db: SqlClient = { async query(text, values) { calls.push({ text, values }); return text.includes('COUNT') ? { rows: [{ total: '0' }] } : { rows: [] }; } };
  const result = await new PostgresMessageStore(db).query({ account_id: 'main', type: 'private', sender: '2', priority: 'P1', at_me: true, keyword: 'hi', since: '2024-01-01', until: '2025-01-01', offset: 3, limit: 7 });
  assert.deepEqual(result, { messages: [], total: 0, offset: 3, limit: 7, has_more: false });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.values, ['main', 'private', '2', 'P1', true, '%hi%', '2024-01-01', '2025-01-01']);
});

test('Postgres conversation context is scoped to the target account and conversation', async () => {
 const calls: { text: string; values?: unknown[] }[] = [];
 const db: SqlClient = { async query(text, values) { calls.push({ text, values }); return text.startsWith('SELECT id, account_id') ? { rows: [{ ...message, id: message.id, account_id: 'main', conversation_id: 'c1', provider_id: null, transport_id: null, direction: 'incoming', sent_at: new Date(), received_at: new Date(), deadline: null, raw_message: 'hello', at_users: [], raw_event: {} }] } : text.includes('ORDER BY m.sent_at') ? { rows: [] } : { rows: [] }; } };
 await new PostgresMessageStore(db).context(message.id, 4, 2);
 assert.deepEqual(calls[0]!.values, [message.id]);
 assert.match(calls[1]!.text, /conversation_id/);
 assert.deepEqual(calls[1]!.values, ['main', message.id]);
});
