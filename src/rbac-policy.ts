/** Route-level authorization policy. This module intentionally does not authenticate users. */
export const RBAC_ROLES = ['admin', 'operator', 'reader'] as const;
export type RbacRole = (typeof RBAC_ROLES)[number];

/** Stable action identifiers for route handlers; unknown identifiers are denied. */
export const RBAC_ACTIONS = [
  'inbox.read',
  'inbox.process',
  'inbox.dismiss',
  'message.send',
  'message.revoke',
  'contacts.read',
  'contacts.sync',
  'history.read',
  'audit.read',
  'notifications.read',
  'notifications.manage',
  'priority.read',
  'priority.manage',
  'inbox_rules.read',
  'inbox_rules.manage',
  'accounts.read',
  'accounts.manage',
  'provider_capabilities.read',
] as const;
export type RbacAction = (typeof RBAC_ACTIONS)[number];

const ROLE_ACTIONS: Readonly<Record<RbacRole, ReadonlySet<RbacAction>>> = {
  reader: new Set<RbacAction>([
    'inbox.read', 'contacts.read', 'history.read', 'audit.read',
    'notifications.read', 'priority.read', 'inbox_rules.read',
    'accounts.read', 'provider_capabilities.read',
  ]),
  operator: new Set<RbacAction>([
    'inbox.read', 'inbox.process', 'inbox.dismiss', 'message.send', 'message.revoke',
    'contacts.read', 'contacts.sync', 'history.read', 'audit.read',
    'notifications.read', 'priority.read', 'priority.manage',
    'inbox_rules.read', 'inbox_rules.manage', 'accounts.read', 'provider_capabilities.read',
  ]),
  admin: new Set<RbacAction>(RBAC_ACTIONS),
};

/** Returns false for malformed roles/actions; policy always defaults to deny. */
export function isActionAllowed(role: unknown, action: unknown): boolean {
  if (typeof role !== 'string' || !RBAC_ROLES.includes(role as RbacRole)) return false;
  if (typeof action !== 'string' || !RBAC_ACTIONS.includes(action as RbacAction)) return false;
  return ROLE_ACTIONS[role as RbacRole].has(action as RbacAction);
}
