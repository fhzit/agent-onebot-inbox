import type { AiAdvisoryConsentRepository, AiAdvisoryConsentState } from './ai-advisory-consent.js';

type TransactionClient = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release?: () => void;
};
type Queryable = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  connect?: () => Promise<TransactionClient>;
};

type ConsentRow = {
  account_id: string;
  enabled: boolean;
  actor: string;
  disclosure_version: string;
  updated_at: Date | string;
  revision: number | string;
};

/** Durable PostgreSQL adapter. Migration 0015 must be applied by the migration role first. */
export class PostgresAiAdvisoryConsentStore implements AiAdvisoryConsentRepository {
  constructor(private readonly db: Queryable) {}

  async get(accountId: string): Promise<AiAdvisoryConsentState | undefined> {
    validateAccount(accountId);
    const result = await this.db.query<ConsentRow>(
      `SELECT account_id, enabled, actor, disclosure_version, updated_at, revision
       FROM ai_advisory_consent WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async put(state: AiAdvisoryConsentState): Promise<void> {
    validateState(state);
    const result = await this.db.query<ConsentRow>(
      `INSERT INTO ai_advisory_consent (account_id, enabled, actor, disclosure_version, updated_at, revision)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
       ON CONFLICT (account_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         actor = EXCLUDED.actor,
         disclosure_version = EXCLUDED.disclosure_version,
         updated_at = EXCLUDED.updated_at,
         revision = EXCLUDED.revision
       RETURNING account_id, enabled, actor, disclosure_version, updated_at, revision`,
      [state.accountId, state.enabled, state.enabled ? state.grantedBy : state.revokedBy,
        (state as Record<string, unknown>).disclosureVersion ?? 'unspecified',
        state.enabled ? state.grantedAt : state.revokedAt, state.revision],
    );
    if (!result.rows[0]) throw new Error('consent upsert returned no row');
  }

  async update(
    accountId: string,
    build: (previous: AiAdvisoryConsentState | undefined) => AiAdvisoryConsentState,
  ): Promise<AiAdvisoryConsentState> {
    validateAccount(accountId);
    if (!this.db.connect) throw new TypeError('consent update requires a transaction-capable PostgreSQL pool');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ConsentRow>(
        `SELECT account_id, enabled, actor, disclosure_version, updated_at, revision
         FROM ai_advisory_consent WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      );
      const previous = result.rows[0] ? mapRow(result.rows[0]) : undefined;
      const next = build(previous);
      validateState(next);
      const write = await client.query<ConsentRow>(
        `INSERT INTO ai_advisory_consent (account_id, enabled, actor, disclosure_version, updated_at, revision)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
         ON CONFLICT (account_id) DO UPDATE SET enabled = EXCLUDED.enabled, actor = EXCLUDED.actor,
           disclosure_version = EXCLUDED.disclosure_version, updated_at = EXCLUDED.updated_at, revision = EXCLUDED.revision
         RETURNING account_id, enabled, actor, disclosure_version, updated_at, revision`,
        [accountId, next.enabled, next.enabled ? next.grantedBy : next.revokedBy,
          next.disclosureVersion, next.enabled ? next.grantedAt : next.revokedAt, next.revision],
      );
      if (!write.rows[0]) throw new Error('consent update returned no row');
      await client.query('COMMIT');
      return mapRow(write.rows[0]);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release?.();
    }
  }
}

function mapRow(row: ConsentRow): AiAdvisoryConsentState {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1 || typeof row.enabled !== 'boolean') throw new TypeError('database returned invalid consent state');
  const timestamp = new Date(row.updated_at);
  if (!Number.isFinite(timestamp.getTime())) throw new TypeError('database returned invalid consent timestamp');
  if (row.enabled) return Object.freeze({ accountId: row.account_id, enabled: true, grantedAt: timestamp.toISOString(), grantedBy: row.actor, disclosureVersion: row.disclosure_version, revision });
  return Object.freeze({ accountId: row.account_id, enabled: false, revokedAt: timestamp.toISOString(), revokedBy: row.actor, disclosureVersion: row.disclosure_version, revision });
}

function validateAccount(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > 128) throw new TypeError('invalid account ID');
}
function validateState(state: AiAdvisoryConsentState): void {
  validateAccount(state.accountId);
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) throw new TypeError('invalid consent revision');
  const actor = state.enabled ? state.grantedBy : state.revokedBy;
  const at = state.enabled ? state.grantedAt : state.revokedAt;
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 200 || !Number.isFinite(Date.parse(at)) || typeof state.disclosureVersion !== 'string' || !state.disclosureVersion.trim() || state.disclosureVersion.length > 128) throw new TypeError('invalid consent state');
}
