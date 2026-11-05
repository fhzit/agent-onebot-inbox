import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import { PostgresProviderQualificationStore } from '../src/provider-qualification-pg-store.js';

const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');
};

const safetyReason = (value?: string, allowRemote = false): string | undefined => {
  if (!value) return 'set TEST_DATABASE_URL to opt in';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return 'TEST_DATABASE_URL must use PostgreSQL';
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    if (!databaseName || !/(?:^|[-_])(test|tests|testing|ci|tmp|temp)(?:$|[-_])/i.test(databaseName)) {
      return 'TEST_DATABASE_URL database name must clearly identify a test/temporary database';
    }
    if (!allowRemote && !isLoopbackHost(parsed.hostname)) return 'remote PostgreSQL host refused (set ALLOW_REMOTE_TEST_DATABASE=true to explicitly allow)';
    return undefined;
  } catch {
    return 'TEST_DATABASE_URL must be a valid PostgreSQL URL';
  }
};

test('PostgreSQL integration safety guard refuses remote hosts by default', () => {
  assert.match(safetyReason('postgres://user:secret@db.example.com/app_test') ?? '', /remote PostgreSQL host refused/);
  assert.equal(safetyReason('postgres://user:***@localhost/app_test'), undefined);
  assert.match(safetyReason('postgres://user:***@localhost./app_test') ?? '', /remote PostgreSQL host refused/);
  assert.match(safetyReason('postgres://user:***@localhost.example.com/app_test') ?? '', /remote PostgreSQL host refused/);
  assert.equal(safetyReason('postgres://user:***@127.0.0.2/app_test'), undefined);
  assert.equal(safetyReason('postgres://user:***@[::1]/app_test'), undefined);
  assert.match(safetyReason('postgres://user:***@[2001:db8::1]/app_test') ?? '', /remote PostgreSQL host refused/);
});

test('PostgreSQL integration safety guard validates database path literally', () => {
  assert.equal(safetyReason('postgres://user:***@localhost/app_test_db'), undefined);
  assert.match(safetyReason('postgres://user:***@localhost/app%2Ftest') ?? '', /database name/);
  assert.match(safetyReason('postgres://user:***@localhost/app%2Etest') ?? '', /database name/);
  assert.match(safetyReason('postgres://user:***@localhost/app%ZZ_test') ?? '', /valid PostgreSQL URL/);
  assert.match(safetyReason('postgres://user:***@localhost/') ?? '', /database name/);
});

test('PostgreSQL integration safety guard allows remote hosts only with explicit opt-in', () => {
  assert.equal(safetyReason('postgres://user:secret@db.example.com/app_test', true), undefined);
  assert.match(safetyReason('postgres://user:secret@db.example.com/production') ?? '', /database name/);
});

test('PostgreSQL integration safety guard does not disclose connection URLs', () => {
  const reason = safetyReason('postgres://user:secret@db.example.com/app_test');
  assert.ok(reason);
  assert.doesNotMatch(reason, /secret|db\.example\.com|postgres:/);
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const allowRemote = process.env.ALLOW_REMOTE_TEST_DATABASE === 'true';
const skipReason = safetyReason(databaseUrl, allowRemote);

test('qualification migration and store work against an isolated PostgreSQL schema', { skip: skipReason }, async () => {
  const url = databaseUrl!;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const schema = `qualification_it_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^qualification_it_[a-f0-9]{32}$/);
  let scoped: pg.Pool | undefined;
  let schemaCreated = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    scoped = new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` });
    const migration = await readFile(fileURLToPath(new URL('../migrations/0012_provider_qualification.sql', import.meta.url)), 'utf8');
    await scoped.query(migration);

    const firstStore = new PostgresProviderQualificationStore(scoped);
    const input = { provider: 'napcat', version: 'integration-1.0', checks: [
      { id: 'outbound.private-text', status: 'pass' as const, evidence: 'isolated PostgreSQL integration run' },
      { id: 'inbound.private-message', status: 'unverified' as const },
    ] };
    const inserted = await firstStore.record(input);
    assert.equal(inserted.provider, 'napcat');
    assert.equal(inserted.checks[0]?.providerTested, true);
    assert.equal(inserted.checks[1]?.providerTested, false);
    assert.equal((await firstStore.get('napcat', 'integration-1.0'))?.checks[0]?.status, 'pass');

    const replaced = await new PostgresProviderQualificationStore(scoped).record({
      provider: 'napcat', version: 'integration-1.0', checks: [
        { id: 'outbound.private-text', status: 'fail', evidence: 'updated after recreation' },
      ],
    });
    assert.equal(replaced.checks[0]?.status, 'fail');
    assert.equal((await new PostgresProviderQualificationStore(scoped).get('napcat', 'integration-1.0'))?.checks[0]?.evidence, 'updated after recreation');

    await assert.rejects(() => scoped!.query(
      `INSERT INTO provider_qualification_results(provider, version, checks) VALUES ($1, $2, $3::jsonb)`,
      ['INVALID PROVIDER', 'integration-1.0', '[]'],
    ));
    await assert.rejects(() => scoped!.query(
      `INSERT INTO provider_qualification_results(provider, version, checks) VALUES ($1, $2, $3::jsonb)`,
      ['napcat', 'integration-1.0', '{}'],
    ));
    await assert.rejects(() => scoped!.query(
      `INSERT INTO provider_qualification_results(provider, version, checks) VALUES ($1, $2, $3::jsonb)`,
      ['napcat', 'integration-1.0', '[]'],
    ));
  } finally {
    try {
      await scoped?.end();
    } finally {
      try {
        if (schemaCreated) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }
});