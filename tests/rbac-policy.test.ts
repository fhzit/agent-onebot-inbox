import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isActionAllowed, RBAC_ACTIONS, RBAC_ROLES, type RbacAction, type RbacRole } from '../src/rbac-policy.js';

const expected: Record<RbacRole, ReadonlySet<RbacAction>> = {
  reader: new Set(['inbox.read', 'contacts.read', 'history.read', 'audit.read', 'notifications.read', 'priority.read', 'inbox_rules.read', 'accounts.read', 'provider_capabilities.read']),
  operator: new Set(['inbox.read', 'inbox.process', 'inbox.dismiss', 'message.send', 'message.revoke', 'contacts.read', 'contacts.sync', 'history.read', 'audit.read', 'notifications.read', 'priority.read', 'priority.manage', 'inbox_rules.read', 'inbox_rules.manage', 'accounts.read', 'provider_capabilities.read']),
  admin: new Set(RBAC_ACTIONS),
};

describe('RBAC policy', () => {
  it('maps every declared role/action pair explicitly and exhaustively', () => {
    assert.deepEqual([...RBAC_ROLES], ['admin', 'operator', 'reader']);
    for (const role of RBAC_ROLES) {
      for (const action of RBAC_ACTIONS) {
        assert.equal(isActionAllowed(role, action), expected[role].has(action), `${role} -> ${action}`);
      }
    }
  });

  it('denies unknown, malformed, or missing roles and actions by default', () => {
    for (const role of [undefined, null, '', 'Admin', 'owner', 0, {}]) {
      assert.equal(isActionAllowed(role, 'inbox.read'), false);
    }
    for (const action of [undefined, null, '', 'inbox.*', 'accounts.delete', 0, {}]) {
      assert.equal(isActionAllowed('admin', action), false);
    }
  });

  it('keeps management privileges exclusive to admin', () => {
    const adminOnly: RbacAction[] = ['accounts.manage', 'notifications.manage'];
    for (const role of ['reader', 'operator'] as const) {
      for (const action of adminOnly) assert.equal(isActionAllowed(role, action), false);
    }
    for (const action of adminOnly) assert.equal(isActionAllowed('admin', action), true);
  });
});
