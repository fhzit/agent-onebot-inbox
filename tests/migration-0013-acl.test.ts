import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const migration = readFileSync(new URL('../migrations/0013_idempotency_adjudications.sql', import.meta.url), 'utf8');

function normalizedSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const sql = normalizedSql(migration);

describe('migration 0013 ACL safety', () => {
  it('revokes inherited PUBLIC access on the table and generated id sequence', () => {
    assert.match(sql, /revoke all on table outbound_idempotency_adjudications from public;/);
    assert.match(sql, /revoke all on sequence outbound_idempotency_adjudications_id_seq from public;/);
  });

  it('gives aoi_app only read/append table privileges and required sequence privileges', () => {
    assert.match(sql, /revoke all on table outbound_idempotency_adjudications from aoi_app;/);
    assert.match(sql, /revoke all on sequence outbound_idempotency_adjudications_id_seq from aoi_app;/);
    assert.match(sql, /grant select, insert on table outbound_idempotency_adjudications to aoi_app;/);
    assert.match(sql, /grant usage, select on sequence outbound_idempotency_adjudications_id_seq to aoi_app;/);
    assert.doesNotMatch(sql, /grant\s+[^;]*(?:update|delete|truncate|references|trigger|all\s+privileges)[^;]*\s+on\s+table\s+outbound_idempotency_adjudications\s+to\s+aoi_app/);
  });

  it('explains role ownership and sequence scope caveats for operators', () => {
    assert.match(migration, /owner/i);
    assert.match(migration, /sequence/i);
    assert.match(migration, /role/i);
  });
});
