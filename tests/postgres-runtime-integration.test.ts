import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';

test('Postgres store writes only existing account IDs and maps SQL rows through conversations', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const msg = normalizeEvent('main', 'napcat', 'http:main', { post_type: 'message', message_type: 'private', self_id: '10001', user_id: '42', message_id: 1, time: 1700000000, message: 'hello' })!;
  const db: SqlClient = { async query(text, values) {
    calls.push({text, values});
    if (text.includes('INSERT INTO conversations')) return { rows: [{id: msg.conversation_id}] };
    if (text.includes('INSERT INTO messages')) return { rows: [{id: msg.id, account_id: 'main'}] };
    if (text.includes('SELECT m.id')) return { rows: [{...msg, id:msg.id, account_id:'main', conversation_id:msg.conversation_id, conversation_type:'private', provider_id:null, transport_id:null, raw_message:[{type:'text',data:{text:'hello'}}], sent_at:new Date(), received_at:new Date(), deadline:null}] };
    return { rows: [] };
  }};
  const store = new PostgresMessageStore(db);
  const inserted = await store.insert(msg);
  assert.equal(inserted.inserted, true);
  assert.match(calls[0]!.text, /ON CONFLICT\(id\) DO UPDATE/);
  assert.match(calls[1]!.text, /ON CONFLICT\(account_id,type,external_id\)/);
  const found = await store.get(msg.id);
  assert.equal(found?.conversation_id, msg.conversation_id);
  assert.match(calls[4]!.text, /JOIN conversations/);
});
