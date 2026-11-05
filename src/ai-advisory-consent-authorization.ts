/** Authorization boundary for consent operations; callers must pass verified claims. */
export type AiAdvisoryConsentPrincipal = Readonly<{
  sub?: unknown;
  accountIds?: unknown;
}>;

export type AiAdvisoryConsentAccount = Readonly<{
  id: unknown;
  enabled: unknown;
}>;

export type AiAdvisoryConsentAction = 'grant' | 'revoke' | 'query';

/** Resolves the authenticated actor only when its identity and requested account are valid. */
export function authorizeAiAdvisoryConsent(
  principal: AiAdvisoryConsentPrincipal | null | undefined,
  action: AiAdvisoryConsentAction,
  accountId: unknown,
  accounts: readonly AiAdvisoryConsentAccount[],
): { allowed: true; actor: string; accountId: string; action: AiAdvisoryConsentAction } | { allowed: false } {
  const deny = { allowed: false } as const;
  if (!principal || typeof principal.sub !== 'string' || principal.sub.trim() === '' || principal.sub !== principal.sub.trim() || principal.sub.length > 128) return deny;
  if (!['grant', 'revoke', 'query'].includes(action)) return deny;
  if (typeof accountId !== 'string' || accountId.trim() === '' || accountId !== accountId.trim() || accountId.length > 128) return deny;
  if (!Array.isArray(principal.accountIds) || !principal.accountIds.includes(accountId)) return deny;
  if (!Array.isArray(accounts) || !accounts.some(account => account && account.id === accountId && account.enabled === true)) return deny;
  return { allowed: true, actor: principal.sub, accountId, action };
}
