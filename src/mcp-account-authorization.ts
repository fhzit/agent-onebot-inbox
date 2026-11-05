/** Authenticated identity claims are supplied by the caller's verified auth layer. */
export type McpPrincipal = Readonly<{ sub?: unknown; accountIds?: unknown }>;
export type McpAccount = Readonly<{ id: string; enabled: boolean }>;

/** Returns accounts the authenticated principal may access; malformed or absent claims deny all. */
export function authorizedMcpAccountIds(
  principal: McpPrincipal | null | undefined,
  accounts: readonly McpAccount[],
): string[] {
  if (!principal || typeof principal !== 'object' || !Array.isArray(accounts)) return [];
  if (!Object.prototype.hasOwnProperty.call(principal, 'sub') || !Object.prototype.hasOwnProperty.call(principal, 'accountIds')) return [];
  if (typeof principal.sub !== 'string' || principal.sub.trim() === '') return [];
  if (!Array.isArray(principal.accountIds)) return [];
  const allowlist = new Set(principal.accountIds.filter((id): id is string => typeof id === 'string' && id.trim() !== ''));
  if (allowlist.size === 0) return [];
  const authorized = new Set<string>();
  for (const account of accounts) {
    if (!account || typeof account !== 'object' || typeof account.id !== 'string' || account.id.trim() === '' || account.enabled !== true) continue;
    if (allowlist.has(account.id)) authorized.add(account.id);
  }
  return [...authorized];
}

/** Explicit account selection is permitted only when present in the authorized set. */
export function isMcpAccountAuthorized(
  principal: McpPrincipal | null | undefined,
  accountId: string,
  accounts: readonly McpAccount[],
): boolean {
  return authorizedMcpAccountIds(principal, accounts).includes(accountId);
}
