import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import { normalizeEvent } from '../src/normalize.js';

function message() { return normalizeEvent('main', 'napcat', 'ws', { post_type: 'message', message_type: 'private', self_id: '1', user_id: '2', message_id: 3, time: 1700000000, message: 'hello' })!; }

test('PostgresMessageStore inserts normalized records and maps SQL rows', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client: SqlClient = { async query(text, values) { calls.push({ text, values }); return { rows: [{ ...message(), segments: message().segments, at_users: [], raw_event: {}, inserted: true }] }; } };
  const result = await new PostgresMessageStore(client).insert(message());
  assert.equal(result.inserted, true);
  assert.match(calls[2]!.text, /conversation_id/);
  assert.match(calls[2]!.text, /INSERT INTO messages/);
  assert.equal(calls[2]!.values?.[0], message().id);
});

test('incoming duplicate resolves to existing message and account scoped lookup/list/summary query safely', async () => {
 const calls: { text: string; values?: unknown[] }[] = [];
 const client: SqlClient = { async query(text, values) { calls.push({ text, values }); if(text.includes('INSERT INTO conversations'))return{rows:[{id:message().conversation_id}]}; return { rows: text.includes('INSERT INTO messages') ? [] : text.includes('SELECT m.id') && calls.filter(c => c.text.includes('INSERT INTO messages')).length > 0 ? [{ ...message(), conversation_type:'private' }] : [] }; } };
 const store = new PostgresMessageStore(client);
 const dupe = await store.insert(message());
 assert.equal(dupe.inserted, false);
 assert.match(calls[2]!.text, /event_fingerprint/);
 assert.match(calls[2]!.text, /INSERT INTO messages/);
 await store.get('id'); await store.list('main', 10); await store.summary('main', '2020-01-01');
 assert.match(calls[4]!.text, /WHERE m.id=/);
 assert.match(calls[5]!.text, /WHERE m\.account_id=\$1/);
 assert.match(calls[6]!.text, /GROUP BY m\.account_id/);
 assert.match(calls[7]!.text, /ORDER BY m.sent_at DESC LIMIT/);
 assert.deepEqual(calls[6]!.values, ['main', '2020-01-01']);
});
