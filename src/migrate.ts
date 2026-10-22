import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';

export async function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
    const files = (await readdir(dir)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [741029441]);
        const prior = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
        if (prior.rowCount) { await client.query('COMMIT'); continue; }
        await client.query(await readFile(path.join(dir, name), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
  } finally { await pool.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().then(() => console.log('Database migrations applied')).catch(error => {
    console.error('Database migration failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  });
}
