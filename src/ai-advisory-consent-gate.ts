import type { AiAdvisoryConsentService } from './ai-advisory-consent.js';

/** Runs classification only while the authoritative account consent is active.
 * Rechecks immediately before persistence so a revoke during classification blocks the write.
 * The recorder then validates the exact consent revision under a row lock in the same transaction as INSERT.
 * A revoke committing after this persistence transaction commits cannot retract the advisory. This wrapper does not serialize external classifier dispatch with consent changes.
 */
export async function withAiAdvisoryConsent<T>(
  accountId: string,
  consent: Pick<AiAdvisoryConsentService, 'query'>,
  classify: (expectedRevision: number) => Promise<T | undefined>,
  persist: (result: T, expectedRevision: number) => Promise<void>,
): Promise<boolean> {
  try {
    const initial = await consent.query(accountId);
    if (initial?.enabled !== true || !Number.isSafeInteger(initial.revision) || initial.revision < 1) return false;
    const result = await classify(initial.revision);
    if (result === undefined) return false;
    const current = await consent.query(accountId);
    if (current?.enabled !== true || current.revision !== initial.revision) return false;
    await persist(result, initial.revision);
    return true;
  } catch {
    return false;
  }
}
