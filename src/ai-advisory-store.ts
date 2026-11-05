export type AiAdvisoryInput = Omit<AiAdvisoryPersistInput, 'expectedConsentRevision'> & { expectedConsentRevision?: number };
export type AiAdvisoryPersistInput = {
  accountId: string;
  messageId: string;
  label: string;
  confidence: number;
  model: string;
  policyVersion: string;
  expectedConsentRevision: number;
};

export type AiAdvisoryRecord = Omit<AiAdvisoryInput, 'expectedConsentRevision'> & { createdAt: string };
export type AiAdvisoryPage = { before?: string; beforeMessageId?: string; limit?: number };

type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }> };
type TransactionClient = Queryable & { release?: () => void };
type TransactionPool = Queryable & { connect?: () => Promise<TransactionClient> };
type Row = { account_id: string; message_id: string; label: string; confidence: number; model: string; policy_version: string; created_at: Date | string };
const MAX_FIELD = 128;
const MAX_PAGE_SIZE = 100;

/** Durable metadata-only store. Caller must supply already policy-validated label output. */
export class PostgresAiAdvisoryStore {
  constructor(private readonly db: TransactionPool) {}

  async record(input: AiAdvisoryInput): Promise<AiAdvisoryRecord> {
    validate(input);
    if (!Number.isSafeInteger(input.expectedConsentRevision) || input.expectedConsentRevision! < 1) throw new TypeError('expectedConsentRevision must be a positive safe integer');
    if (!this.db.connect) throw new TypeError('AI advisory persistence requires a transaction-capable PostgreSQL pool');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<Row>(
      `INSERT INTO ai_advisories(account_id, message_id, label, confidence, model, policy_version)
       SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (
         SELECT 1 FROM messages WHERE account_id = $1 AND id = $2
       ) AND EXISTS (
         SELECT 1 FROM ai_advisory_consent WHERE account_id = $1 AND enabled = TRUE AND revision = $7
         FOR UPDATE
       )
       ON CONFLICT (account_id, message_id, policy_version) DO UPDATE SET
         label = EXCLUDED.label, confidence = EXCLUDED.confidence, model = EXCLUDED.model, created_at = now()
       RETURNING account_id, message_id, label, confidence, model, policy_version, created_at`,
      [input.accountId, input.messageId, input.label, input.confidence, input.model, input.policyVersion, input.expectedConsentRevision],
      );
      if (!result.rows[0]) throw new Error('AI advisory message or current consent revision not found');
      await client.query('COMMIT');
      return toRecord(result.rows[0]);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async list(accountId: string, options: AiAdvisoryPage = {}): Promise<AiAdvisoryRecord[]> {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId !== accountId.trim()) throw new TypeError('accountId must be a non-empty, unpadded string');
    const hasTime = options.before !== undefined;
    const hasMessage = options.beforeMessageId !== undefined;
    if (hasTime !== hasMessage) throw new TypeError('before and beforeMessageId must be supplied together');
    if (hasTime && (typeof options.before !== 'string' || !Number.isFinite(Date.parse(options.before!)))) throw new TypeError('before must be a valid timestamp');
    if (hasMessage && (typeof options.beforeMessageId !== 'string' || !options.beforeMessageId!.trim())) throw new TypeError('beforeMessageId must be a non-empty string');
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new RangeError(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
    const result = await this.db.query<Row>(
      `SELECT account_id, message_id, label, confidence, model, policy_version, created_at
       FROM ai_advisories WHERE account_id = $1
         AND ($2::timestamptz IS NULL OR (created_at, message_id) < ($2::timestamptz, $3::text))
       ORDER BY created_at DESC, message_id DESC LIMIT $4`,
      [accountId, options.before ?? null, options.beforeMessageId ?? null, limit],
    );
    return result.rows.map(toRecord);
  }
}

function validate(input: AiAdvisoryInput): void {
  if (!input || typeof input !== 'object') throw new TypeError('input is required');
  for (const key of ['accountId', 'messageId', 'label', 'model', 'policyVersion'] as const) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > MAX_FIELD) throw new TypeError(`${key} must be a non-empty, unpadded string of at most ${MAX_FIELD} characters`);
  }
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new TypeError('confidence must be between 0 and 1');
}
function toRecord(row: Row): AiAdvisoryRecord {
  const createdAt = new Date(row.created_at);
  if (!Number.isFinite(createdAt.getTime())) throw new TypeError('database returned invalid advisory timestamp');
  return { accountId: row.account_id, messageId: row.message_id, label: row.label, confidence: Number(row.confidence), model: row.model, policyVersion: row.policy_version, createdAt: createdAt.toISOString() };
}
