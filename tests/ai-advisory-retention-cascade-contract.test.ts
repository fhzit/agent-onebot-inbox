import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PostgresAiAdvisoryRetentionRepository } from '../src/ai-advisory-retention-adapter.js';

test('retention deletes advisory identities only and cannot delete parent messages', async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const repository = new PostgresAiAdvisoryRetentionRepository({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  });
  const records = [
    { accountId: 'account-a', messageId: "message-'1", policyVersion: 'policy-v1' },
    { accountId: 'account-a', messageId: 'message-2', policyVersion: 'policy-v2' },
  ];

  assert.equal(await repository.deleteAdvisories({ accountId: 'account-a', records }), 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^\s*DELETE\s+FROM\s+ai_advisories\b/i);
  assert.doesNotMatch(calls[0].text, /DELETE\s+FROM\s+messages\b/i);
  assert.match(calls[0].text, /advisory\.account_id\s*=\s*\$1/);
  assert.match(calls[0].text, /advisory\.message_id\s*=\s*requested\.message_id/);
  assert.match(calls[0].text, /advisory\.policy_version\s*=\s*requested\.policy_version/);
  assert.deepEqual(calls[0].values, ['account-a', "message-'1", 'policy-v1', 'message-2', 'policy-v2']);
  assert.doesNotMatch(calls[0].text, /message-'1|message-2|policy-v1|policy-v2|account-a/);
});

test('account deletion cascade is declared from account to advisories, never from messages to parent deletion', async () => {
  const migration = await readFile(new URL('../migrations/0014_ai_advisories.sql', import.meta.url), 'utf8');
  const table = migration.match(/CREATE TABLE ai_advisories\s*\(([\s\S]*?)\n\);/i)?.[1];
  assert.ok(table, 'ai_advisories table declaration exists');
  assert.match(table, /FOREIGN KEY\s*\(account_id\)\s*REFERENCES\s+accounts\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(table, /FOREIGN KEY\s*\(account_id,\s*message_id\)\s*REFERENCES\s+messages\s*\(account_id,\s*id\)\s+ON DELETE CASCADE/i);
  assert.match(migration, /ALTER TABLE messages ADD CONSTRAINT messages_account_id_id_key UNIQUE \(account_id, id\)/i);
  assert.match(table, /PRIMARY KEY\s*\(account_id,\s*message_id,\s*policy_version\)/i);
});
