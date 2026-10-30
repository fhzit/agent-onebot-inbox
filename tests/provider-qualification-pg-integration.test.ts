import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import { PostgresProviderQualificationStore } from '../src/provider-qualification-pg-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = (() => {
  if (!databaseUrl) return '';
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return '';
    return decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    return '';
  }
})();
// The test refuses to connect unless the explicitly supplied database name is
// clearly disposable. The schema name below is generated locally and validated
// before it is ever interpolated as an SQL identifier.
const optInIsSafe = Boolean(databaseUrl && databaseName && /(?:^|[-_])(test|tests|testing|ci|tmp|temp)(?:$|[-_])/i.test(databaseName));

test('qualification migration and store work against an isolated PostgreSQL schema', { skip: !optInIsSafe && (databaseUrl ? 'TEST_DATABASE_URL database name must clearly identify a test/temporary database' : 'set TEST_DATABASE_URL to opt in') }, async () => {
  const url = databaseUrl!;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const schema = `qualification_it_${randomUUID().replaceAll('-', '')}`;
  // Keep identifier interpolation constrained to a locally generated, safe SQL identifier.
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
