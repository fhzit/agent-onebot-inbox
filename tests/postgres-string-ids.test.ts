import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('runtime account and message identifiers are stored as text without UUID casts', async () => {
  const migration = await readFile(new URL('../migrations/0003_runtime_string_ids.sql', import.meta.url), 'utf8');
  assert.match(migration, /accounts\s+ALTER COLUMN id TYPE text/);
  assert.match(migration, /messages\s+ALTER COLUMN account_id TYPE text/);
  assert.match(migration, /messages\s+ALTER COLUMN id TYPE text/);
});