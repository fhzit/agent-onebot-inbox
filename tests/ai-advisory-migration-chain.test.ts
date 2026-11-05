import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration0003 = readFileSync(new URL('../migrations/0003_runtime_string_ids.sql', import.meta.url), 'utf8');
const migration0014 = readFileSync(new URL('../migrations/0014_ai_advisories.sql', import.meta.url), 'utf8');
const migration0015 = readFileSync(new URL('../migrations/0015_ai_advisory_consent.sql', import.meta.url), 'utf8');

test('advisory foreign-key identifier types match the runtime-string schema migration', () => {
  assert.match(migration0003, /ALTER TABLE accounts ALTER COLUMN id TYPE text USING id::text/i);
  assert.match(migration0003, /ALTER TABLE messages ALTER COLUMN id TYPE text USING id::text/i);
  assert.match(migration0014, /account_id text NOT NULL/i);
  assert.match(migration0014, /message_id text NOT NULL/i);
  assert.match(migration0014, /FOREIGN KEY \(account_id\) REFERENCES accounts\(id\)/i);
  assert.match(migration0014, /FOREIGN KEY \(account_id, message_id\) REFERENCES messages\(account_id, id\)/i);
  assert.match(migration0015, /account_id text PRIMARY KEY/i);
  assert.match(migration0015, /FOREIGN KEY \(account_id\) REFERENCES accounts\(id\)/i);
});
