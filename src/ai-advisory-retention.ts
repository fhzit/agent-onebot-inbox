/** Explicit, metadata-only retention policy. This module never deletes messages. */

export type AdvisoryIdentity = {
  accountId: string;
  messageId: string;
  policyVersion: string;
};

export type AdvisoryMetadata = AdvisoryIdentity & { createdAt: string };

export type RetentionPreview = {
  accountId: string;
  cutoff: string;
  retentionDays: number;
  limit: number;
  candidates: AdvisoryIdentity[];
  hasMore: boolean;
  confirmationToken: string;
};

export interface AiAdvisoryRetentionRepository {
  /** Return oldest-first metadata for exactly accountId, strictly before cutoff, capped at limit. */
  listExpired(input: { accountId: string; before: string; limit: number }): Promise<AdvisoryMetadata[]>;
  /** Delete only the specified advisory metadata identities for exactly accountId. */
  deleteAdvisories(input: { accountId: string; records: AdvisoryIdentity[] }): Promise<number>;
}

export type RetentionOptions = { retentionDays?: number; limit?: number; now?: Date };

const MAX_RETENTION_DAYS = 3650;
const MAX_BATCH = 500;
const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_BATCH = 100;
const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const confirmations = new Map<string, { accountId: string; cutoff: string; identities: string[]; expiresAt: number; inFlight: boolean }>();

/** Plans deletion without side effects. Applying a preview requires a separate explicit call. */
export async function previewAiAdvisoryRetention(
  repository: AiAdvisoryRetentionRepository,
  accountId: string,
  options: RetentionOptions = {},
): Promise<RetentionPreview> {
  const account = validateAccount(accountId);
  const retentionDays = boundedInteger(options.retentionDays ?? DEFAULT_RETENTION_DAYS, 1, MAX_RETENTION_DAYS, 'retentionDays');
  const limit = boundedInteger(options.limit ?? DEFAULT_BATCH, 1, MAX_BATCH, 'limit');
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('now must be a valid Date');
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await repository.listExpired({ accountId: account, before: cutoff, limit: limit + 1 });
  if (!Array.isArray(rows)) throw new TypeError('repository returned invalid rows');
  // Defensively enforce the contract even if a repository implementation is faulty.
  const eligible = rows.filter(row => row && row.accountId === account && validIdentity(row)
    && Number.isFinite(Date.parse(row.createdAt)) && Date.parse(row.createdAt) < Date.parse(cutoff));
  const unique = new Map<string, AdvisoryIdentity>();
  for (const row of eligible) unique.set(identityKey(row), { accountId: account, messageId: row.messageId, policyVersion: row.policyVersion });
  const candidates = [...unique.values()].slice(0, limit);
  const confirmationToken = randomToken();
  confirmations.set(confirmationToken, { accountId: account, cutoff, identities: candidates.map(identityKey), expiresAt: Date.now() + CONFIRMATION_TTL_MS, inFlight: false });
  return { accountId: account, cutoff, retentionDays, limit, candidates, hasMore: eligible.length > limit, confirmationToken };
}

/** Apply only an explicit preview, rechecking its account and candidate bounds. */
export async function applyAiAdvisoryRetention(
  repository: AiAdvisoryRetentionRepository,
  preview: RetentionPreview,
): Promise<{ accountId: string; requested: number; deleted: number }> {
  if (!preview || typeof preview !== 'object') throw new TypeError('preview is required');
  const accountId = validateAccount(preview.accountId);
  if (typeof preview.confirmationToken !== 'string') throw new TypeError('valid confirmation token is required');
  const confirmation = confirmations.get(preview.confirmationToken);
  if (!confirmation) throw new TypeError('invalid or already used confirmation token');
  if (confirmation.inFlight) throw new TypeError('confirmation token apply is in progress');
  if (Date.now() >= confirmation.expiresAt) {
    confirmations.delete(preview.confirmationToken);
    throw new TypeError('confirmation token has expired');
  }
  boundedInteger(preview.limit, 1, MAX_BATCH, 'preview.limit');
  if (!Array.isArray(preview.candidates) || preview.candidates.length > preview.limit) throw new RangeError('preview candidates exceed limit');
  if (!Number.isFinite(Date.parse(preview.cutoff))) throw new TypeError('preview cutoff must be a valid timestamp');
  const seen = new Set<string>();
  const records = preview.candidates.map(candidate => {
    if (!validIdentity(candidate) || candidate.accountId !== accountId) throw new TypeError('candidate account or identity is invalid');
    const key = identityKey(candidate);
    if (seen.has(key)) throw new TypeError('duplicate candidate identity');
    seen.add(key);
    return { accountId, messageId: candidate.messageId, policyVersion: candidate.policyVersion };
  });
  if (confirmation.accountId !== accountId || confirmation.cutoff !== preview.cutoff
    || confirmation.identities.length !== records.length
    || confirmation.identities.some((key, index) => key !== identityKey(records[index]!))) {
    throw new TypeError('preview does not match confirmation token');
  }
  confirmation.inFlight = true;
  if (records.length === 0) {
    confirmations.delete(preview.confirmationToken);
    return { accountId, requested: 0, deleted: 0 };
  }
  try {
    const deleted = await repository.deleteAdvisories({ accountId, records });
    if (!Number.isInteger(deleted) || deleted < 0 || deleted > records.length) throw new Error('repository returned invalid deletion count');
    confirmations.delete(preview.confirmationToken);
    return { accountId, requested: records.length, deleted };
  } catch (error) {
    confirmation.inFlight = false;
    throw error;
  }
}

function validateAccount(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || value !== value.trim()) throw new TypeError('accountId must be a non-empty, trimmed string of at most 128 characters');
  return value;
}
function validIdentity(value: Partial<AdvisoryIdentity> | null | undefined): value is AdvisoryIdentity {
  return !!value && typeof value.accountId === 'string' && typeof value.messageId === 'string' && !!value.messageId.trim()
    && typeof value.policyVersion === 'string' && !!value.policyVersion.trim();
}
function identityKey(value: AdvisoryIdentity): string { return JSON.stringify([value.accountId, value.messageId, value.policyVersion]); }
function randomToken(): string { return globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID(); }
function boundedInteger(value: unknown, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  return value as number;
}
