import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0014_ai_advisories.sql', import.meta.url), 'utf8');

test('AI advisory identifiers use the opaque text types of accounts/messages', () => {
  const table = migration.match(/CREATE TABLE ai_advisories \(([\s\S]*?)\n\);/i)?.[1];
  assert.ok(table, 'table definition exists');
  assert.match(table, /account_id text NOT NULL/i);
  assert.match(table, /message_id text NOT NULL/i);
  assert.doesNotMatch(table, /\buuid\b/i);
});

test('AI advisory migration binds message ownership to the same account', () => {
  assert.match(migration, /ADD CONSTRAINT messages_account_id_id_key UNIQUE \(account_id, id\)/i, 'required unique target lets PostgreSQL enforce account/message ownership with a composite FK');
  assert.match(migration, /FOREIGN KEY \(account_id, message_id\) REFERENCES messages\(account_id, id\) ON DELETE CASCADE/i);
  assert.match(migration, /FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE CASCADE/i);
  assert.doesNotMatch(migration, /FOREIGN KEY \(message_id\) REFERENCES messages\(id\)/i);
});

test('AI advisory schema retains only bounded classification metadata, not text or reasons', () => {
  const table = migration.match(/CREATE TABLE ai_advisories \(([\s\S]*?)\n\);/i)?.[1];
  assert.ok(table, 'table definition exists');
  assert.match(table, /label text NOT NULL CHECK \(length\(btrim\(label\)\) BETWEEN 1 AND 128\)/i);
  assert.match(table, /confidence real NOT NULL CHECK \(confidence BETWEEN 0 AND 1\)/i);
  assert.match(table, /model text NOT NULL CHECK \(length\(btrim\(model\)\) BETWEEN 1 AND 128\)/i);
  assert.match(table, /policy_version text NOT NULL CHECK \(length\(btrim\(policy_version\)\) BETWEEN 1 AND 128\)/i);
  assert.match(table, /created_at timestamptz NOT NULL DEFAULT now\(\)/i);
  assert.match(table, /PRIMARY KEY \(account_id, message_id, policy_version\)/i);
  assert.doesNotMatch(table, /plain_text|raw_message|raw_result|reason|summary|payload/i);
});

test('AI advisory index supports account-scoped deterministic recency scans and ACL is restricted', () => {
  assert.match(migration, /CREATE INDEX ai_advisories_account_created_idx\s+ON ai_advisories\(account_id, created_at DESC, message_id DESC\)/i);
  assert.match(migration, /REVOKE ALL ON ai_advisories FROM PUBLIC/i);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON ai_advisories TO aoi_app/i);
});
