import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const migration = readFileSync(new URL('../migrations/0015_ai_advisory_consent.sql', import.meta.url), 'utf8');

function normalizedSql(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const sql = normalizedSql(migration);
const table = sql.match(/create table ai_advisory_consent \(([\s\S]*?)\);/)?.[1];

describe('migration 0015 AI advisory consent contract', () => {
  it('uses opaque account text id and cascades when the account is deleted', () => {
    assert.ok(table, 'consent table exists');
    assert.match(table, /account_id text primary key/);
    assert.match(table, /foreign key \(account_id\) references accounts\(id\) on delete cascade/);
    assert.doesNotMatch(table, /\buuid\b/);
  });

  it('stores the current choice, responsible actor, disclosure version, and auditable revision/timestamps', () => {
    assert.ok(table, 'consent table exists');
    assert.match(table, /enabled boolean not null default false/);
    assert.match(table, /actor text not null check \(length\(btrim\(actor\)\) between 1 and 200\)/);
    assert.match(table, /disclosure_version text not null check \(length\(btrim\(disclosure_version\)\) between 1 and 128\)/);
    assert.match(table, /created_at timestamptz not null default now\(\)/);
    assert.match(table, /updated_at timestamptz not null default now\(\)/);
    assert.match(table, /revision bigint not null default 1 check \(revision > 0\)/);
  });

  it('requires the application role to exist, failing closed instead of skipping ACL setup', () => {
    assert.match(sql, /if not exists \(select 1 from pg_roles where rolname = 'aoi_app'\)/);
    assert.match(sql, /raise exception 'migration 0015 requires postgresql role aoi_app to exist'/);
  });

  it('documents the actual runtime privileges and owner/membership limitations', () => {
    assert.match(migration, /runtime needs select\/insert\/update[\s\S]*update \(enabled=false\), not a delete/i);
    assert.match(sql, /revoke all on table ai_advisory_consent from public;/);
    assert.match(sql, /revoke all on table ai_advisory_consent from aoi_app;/);
    assert.match(sql, /grant select, insert, update on table ai_advisory_consent to aoi_app;/);
    assert.match(migration, /these acl changes remove direct grants[\s\S]*do not restrict aoi_app if it owns the table, is superuser, or[\s\S]*inherits equivalent privileges/i);
    assert.match(migration, /trusted non-runtime owner/i);
    assert.doesNotMatch(sql, /grant\s+[^;]*(?:delete|truncate|references|trigger|all\s+privileges)[^;]*\s+on\s+table\s+ai_advisory_consent\s+to\s+aoi_app/);
  });

  it('contains consent metadata only and no message/advisory payload fields', () => {
    assert.ok(table, 'consent table exists');
    assert.doesNotMatch(table, /message|payload|prompt|reason|summary|model/);
  });
});
