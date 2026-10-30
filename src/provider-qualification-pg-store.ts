import { validateProviderQualificationInput } from './provider-qualification-validation.js';
import type { ProviderQualificationRecord, ProviderQualificationRecordInput, ProviderQualificationCheckRecord } from './provider-qualification-store.js';
import type { QualificationState } from './provider-qualification.js';

export interface ProviderQualificationStoreAdapter {
  record(input: ProviderQualificationRecordInput): Promise<ProviderQualificationRecord>;
  get(provider: string, version: string): Promise<ProviderQualificationRecord | undefined>;
}

type QueryResult<T> = { rows: T[] };
type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>> };
type StoredCheck = { id: string; status: QualificationState; evidence?: string; providerTested: true };
type Row = { provider: string; version: string; checks: StoredCheck[]; recorded_at: Date | string };

/** Persist per-version evidence separately from the immutable static checklist. */
export class PostgresProviderQualificationStore implements ProviderQualificationStoreAdapter {
  constructor(private readonly db: Queryable) {}

  async record(input: ProviderQualificationRecordInput): Promise<ProviderQualificationRecord> {
    const validated = validateProviderQualificationInput(input);
    const checks = validated.checks.map(check => ({ ...check, providerTested: check.status !== 'unverified' as const }));
    const result = await this.db.query<Row>(
      `INSERT INTO provider_qualification_results(provider, version, checks)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (provider, version) DO UPDATE SET checks = EXCLUDED.checks, recorded_at = now()
       RETURNING provider, version, checks, recorded_at`,
      [validated.provider, validated.version, JSON.stringify(checks)],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Provider qualification insert returned no row');
    return toRecord(row);
  }

  async get(provider: string, version: string): Promise<ProviderQualificationRecord | undefined> {
    if (typeof provider !== 'string' || typeof version !== 'string') return undefined;
    const result = await this.db.query<Row>(
      'SELECT provider, version, checks, recorded_at FROM provider_qualification_results WHERE provider = $1 AND version = $2',
      [provider.trim().toLowerCase(), version.trim()],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : undefined;
  }
}

function toRecord(row: Row): ProviderQualificationRecord {
  const checks: ProviderQualificationCheckRecord[] = row.checks.map(check => Object.freeze({ ...check }));
  return Object.freeze({ provider: row.provider, version: row.version, checks: Object.freeze(checks), recordedAt: new Date(row.recorded_at).toISOString() });
}
