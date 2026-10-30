/** Admin capabilities are an explicit allow-list; unknown inputs always deny. */
export const ADMIN_CAPABILITIES = [
  'admin.dashboard.read',
  'admin.inbox.read',
  'admin.inbox.manage',
  'admin.messages.send',
  'admin.contacts.read',
  'admin.accounts.read',
  'admin.accounts.manage',
  'admin.audit.read',
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];
export const ADMIN_ROLES = ['viewer', 'operator', 'administrator'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** A principal's accountIds are the maximum accounts it may act on; '*' is explicit global scope. */
export interface AdminPrincipal {
  readonly role: unknown;
  readonly accountIds: readonly string[];
}

export const ADMIN_ROLE_CAPABILITY_MATRIX: Readonly<Record<AdminRole, readonly AdminCapability[]>> = {
  viewer: ['admin.dashboard.read', 'admin.inbox.read', 'admin.contacts.read', 'admin.accounts.read', 'admin.audit.read'],
  operator: ['admin.dashboard.read', 'admin.inbox.read', 'admin.inbox.manage', 'admin.messages.send', 'admin.contacts.read', 'admin.accounts.read', 'admin.audit.read'],
  administrator: ADMIN_CAPABILITIES,
};

const accountScoped = new Set<AdminCapability>([
  'admin.inbox.read', 'admin.inbox.manage', 'admin.messages.send', 'admin.contacts.read', 'admin.accounts.read', 'admin.accounts.manage',
]);

/** Check role permission and, where relevant, an explicitly granted account scope. */
export function authorizeAdminCapability(
  principal: AdminPrincipal | null | undefined,
  capability: unknown,
  accountId?: unknown,
): boolean {
  if (!principal || typeof principal !== 'object') return false;
  if (typeof principal.role !== 'string' || !Object.hasOwn(ADMIN_ROLE_CAPABILITY_MATRIX, principal.role)) return false;
  if (typeof capability !== 'string' || !(ADMIN_CAPABILITIES as readonly string[]).includes(capability)) return false;
  const allowed = ADMIN_ROLE_CAPABILITY_MATRIX[principal.role as AdminRole];
  if (!allowed.includes(capability as AdminCapability)) return false;
  if (!accountScoped.has(capability as AdminCapability)) return accountId === undefined;
  if (typeof accountId !== 'string' || accountId.trim().length === 0) return false;
  if (!Array.isArray(principal.accountIds) || principal.accountIds.some(id => typeof id !== 'string')) return false;
  return principal.accountIds.includes('*') || principal.accountIds.includes(accountId);
}
