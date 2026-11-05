/** Explicit configuration contract for advisory retention. This module has no policy defaults. */

export const AI_ADVISORY_RETENTION_POLICY_VERSION = '1' as const;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
export const MIN_RETENTION_BATCH_SIZE = 1;
export const MAX_RETENTION_BATCH_SIZE = 500;

export type AiAdvisoryRetentionPolicyConfig = {
  version: typeof AI_ADVISORY_RETENTION_POLICY_VERSION;
  retentionDays: number;
  batchSize: number;
};

export type ValidatedAiAdvisoryRetentionPolicy = Readonly<AiAdvisoryRetentionPolicyConfig>;

/** Validate untrusted config; absent, malformed, or out-of-range settings fail closed. */
export function validateAiAdvisoryRetentionPolicy(
  config: unknown,
): ValidatedAiAdvisoryRetentionPolicy {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('retention policy configuration is required');
  }
  const candidate = config as Record<string, unknown>;
  if (candidate.version !== AI_ADVISORY_RETENTION_POLICY_VERSION) {
    throw new TypeError(`retention policy version must be ${AI_ADVISORY_RETENTION_POLICY_VERSION}`);
  }
  if (!Number.isInteger(candidate.retentionDays)
    || (candidate.retentionDays as number) < MIN_RETENTION_DAYS
    || (candidate.retentionDays as number) > MAX_RETENTION_DAYS) {
    throw new RangeError(`retentionDays must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`);
  }
  if (!Number.isInteger(candidate.batchSize)
    || (candidate.batchSize as number) < MIN_RETENTION_BATCH_SIZE
    || (candidate.batchSize as number) > MAX_RETENTION_BATCH_SIZE) {
    throw new RangeError(`batchSize must be an integer between ${MIN_RETENTION_BATCH_SIZE} and ${MAX_RETENTION_BATCH_SIZE}`);
  }
  return Object.freeze({
    version: AI_ADVISORY_RETENTION_POLICY_VERSION,
    retentionDays: candidate.retentionDays as number,
    batchSize: candidate.batchSize as number,
  });
}

/** Compute an ISO UTC cutoff from a validated policy and explicit, valid reference time. */
export function getAiAdvisoryRetentionCutoff(
  policy: ValidatedAiAdvisoryRetentionPolicy,
  now: Date,
): string {
  const validated = validateAiAdvisoryRetentionPolicy(policy);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  return new Date(now.getTime() - validated.retentionDays * 24 * 60 * 60 * 1000).toISOString();
}
