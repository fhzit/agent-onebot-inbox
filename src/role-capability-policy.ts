/** Stable capability identifiers for independently authorizing tools and operations. */
export const ROLE_CAPABILITIES = [
  'inbox.read',
  'inbox.process',
  'message.send',
  'contacts.read',
  'history.read',
  'accounts.manage',
] as const;

export type RoleCapability = (typeof ROLE_CAPABILITIES)[number];
export const USER_ROLES = ['reader', 'operator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Explicit allow-list. Missing roles/capabilities never inherit permissions. */
export const ROLE_CAPABILITY_POLICY: Readonly<Record<UserRole, readonly RoleCapability[]>> = {
  reader: ['inbox.read', 'contacts.read', 'history.read'],
  operator: ['inbox.read', 'inbox.process', 'message.send', 'contacts.read', 'history.read'],
  admin: ROLE_CAPABILITIES,
};

/** Test whether a role grants a known capability; malformed or unknown values deny. */
export function roleHasCapability(role: unknown, capability: unknown): boolean {
  if (typeof role !== 'string' || !Object.hasOwn(ROLE_CAPABILITY_POLICY, role)) return false;
  if (typeof capability !== 'string' || !(ROLE_CAPABILITIES as readonly string[]).includes(capability)) return false;
  return ROLE_CAPABILITY_POLICY[role as UserRole].includes(capability as RoleCapability);
}
