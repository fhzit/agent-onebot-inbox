import type { AdvisoryIdentity } from './ai-advisory-retention.js';

const MAX_BATCH = 500;

type RetentionDelete = (input: { accountId: string; records: AdvisoryIdentity[] }) => Promise<number>;

/** A transaction-scoped operation that can delete only explicit advisory identities. */
export interface AiAdvisoryRetentionTransaction {
  deleteAdvisories: RetentionDelete;
}

/** The runner owns commit/rollback: it must commit on resolution and rollback on rejection. */
export interface AiAdvisoryRetentionTransactionRunner {
  transaction<T>(work: (tx: AiAdvisoryRetentionTransaction) => Promise<T>): Promise<T>;
}

/** Run one explicit, account-fenced advisory deletion batch within a transaction. */
export async function executeAiAdvisoryRetentionBatch(
  runner: AiAdvisoryRetentionTransactionRunner,
  input: { accountId: string; records: AdvisoryIdentity[] },
): Promise<number> {
  validateBatch(input);
  if (input.records.length === 0) return 0;
  return runner.transaction(async tx => {
    const deleted = await tx.deleteAdvisories({
      accountId: input.accountId,
      records: input.records.map(record => ({ ...record })),
    });
    if (!Number.isInteger(deleted) || deleted < 0 || deleted > input.records.length) {
      throw new Error('transaction returned invalid deletion count');
    }
    return deleted;
  });
}

function validateBatch(input: { accountId: string; records: AdvisoryIdentity[] }): void {
  if (!input || typeof input !== 'object' || typeof input.accountId !== 'string' || !input.accountId.trim()
    || input.accountId !== input.accountId.trim() || input.accountId.length > 128) {
    throw new TypeError('accountId must be a non-empty, trimmed string of at most 128 characters');
  }
  if (!Array.isArray(input.records) || input.records.length > MAX_BATCH) {
    throw new RangeError(`records must contain at most ${MAX_BATCH} identities`);
  }
  const seen = new Set<string>();
  for (const record of input.records) {
    if (!record || record.accountId !== input.accountId || typeof record.messageId !== 'string' || !record.messageId.trim()
      || record.messageId !== record.messageId.trim() || typeof record.policyVersion !== 'string' || !record.policyVersion.trim()
      || record.policyVersion !== record.policyVersion.trim()) {
      throw new TypeError('record identity must be valid and match accountId');
    }
    const key = JSON.stringify([record.messageId, record.policyVersion]);
    if (seen.has(key)) throw new TypeError('duplicate advisory identity');
    seen.add(key);
  }
}
