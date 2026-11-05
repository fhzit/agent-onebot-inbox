import type { AdvisoryIdentity, AdvisoryMetadata, AiAdvisoryRetentionRepository } from './ai-advisory-retention.js';

type Queryable = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
};

type RetentionRow = {
  account_id: string;
  message_id: string;
  policy_version: string;
  created_at: Date | string;
};

const MAX_BATCH = 500;

/** Postgres adapter for advisory-only retention operations. */
export class PostgresAiAdvisoryRetentionRepository implements AiAdvisoryRetentionRepository {
  constructor(private readonly db: Queryable) {}

  async listExpired(input: { accountId: string; before: string; limit: number }): Promise<AdvisoryMetadata[]> {
    validateAccount(input.accountId);
    validateTimestamp(input.before);
    validateLimit(input.limit);
    const result = await this.db.query<RetentionRow>(
      `SELECT account_id, message_id, policy_version, created_at
       FROM ai_advisories
       WHERE account_id = $1 AND created_at < $2::timestamptz
       ORDER BY created_at ASC, message_id ASC, policy_version ASC
       LIMIT $3`,
      [input.accountId, input.before, input.limit],
    );
    return result.rows.map(row => {
      const createdAt = new Date(row.created_at);
      if (!Number.isFinite(createdAt.getTime())) throw new TypeError('database returned invalid advisory timestamp');
      return {
        accountId: row.account_id,
        messageId: row.message_id,
        policyVersion: row.policy_version,
        createdAt: createdAt.toISOString(),
      };
    });
  }

  async deleteAdvisories(input: { accountId: string; records: AdvisoryIdentity[] }): Promise<number> {
    validateAccount(input.accountId);
    if (!Array.isArray(input.records) || input.records.length > MAX_BATCH) {
      throw new RangeError(`records must contain at most ${MAX_BATCH} identities`);
    }
    if (input.records.length === 0) return 0;
    const seen = new Set<string>();
    for (const record of input.records) {
      if (!record || record.accountId !== input.accountId || !validText(record.messageId) || !validText(record.policyVersion)) {
        throw new TypeError('record identity must be valid and match accountId');
      }
      const key = JSON.stringify([record.messageId, record.policyVersion]);
      if (seen.has(key)) throw new TypeError('duplicate advisory identity');
      seen.add(key);
    }

    const values: unknown[] = [input.accountId];
    const tuples = input.records.map((record, index) => {
      const messageParam = 2 + index * 2;
      values.push(record.messageId, record.policyVersion);
      return `($${messageParam}::text, $${messageParam + 1}::text)`;
    });
    const result = await this.db.query(
      `DELETE FROM ai_advisories AS advisory
       USING (VALUES ${tuples.join(', ')}) AS requested(message_id, policy_version)
       WHERE advisory.account_id = $1
         AND advisory.message_id = requested.message_id
         AND advisory.policy_version = requested.policy_version`,
      values,
    );
    return result.rowCount ?? 0;
  }
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value === value.trim();
}
function validateAccount(value: unknown): asserts value is string {
  if (!validText(value) || value.length > 128) throw new TypeError('accountId must be a non-empty, trimmed string of at most 128 characters');
}
function validateTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new TypeError('before must be a valid timestamp');
}
function validateLimit(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_BATCH) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_BATCH}`);
  }
}
