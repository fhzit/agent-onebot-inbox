import type { AiAdvisoryConsentService } from './ai-advisory-consent.js';

/** Reads authoritative consent on every call; unavailable or mismatched state denies access. */
export async function isAiAdvisoryConsentActive(
  consent: Pick<AiAdvisoryConsentService, 'query'>,
  accountId: string,
): Promise<boolean> {
  try {
    const state = await consent.query(accountId);
    return state?.accountId === accountId && state.enabled === true;
  } catch {
    return false;
  }
}
