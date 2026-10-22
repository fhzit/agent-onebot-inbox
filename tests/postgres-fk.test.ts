import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import { normalizeEvent } from '../src/normalize.js';

test('Postgres repository creates account and conversation keys before message insert', async () => {
  const calls: string[] = [];
  const message = normalizeEvent('main', 'napcat', 'reverse-ws:main', { post_type: 'message', message_type: 'private', self_id: '10001', user_id: '42', message_id: 7, time: 1700000000, message: 'hello' })!;
  const db: SqlClient = { async query(text) { calls.push(text); if (text.includes('RETURNING')) return { rows: [message] }; return { rows: [] }; } };
  await new PostgresMessageStore(db).insert(message);
  assert.match(calls[0]!, /INSERT INTO accounts/);
  assert.match(calls[1]!, /INSERT INTO conversations\(id,account_id,type,external_id/);
  assert.match(calls[2]!, /INSERT INTO messages/);
});
