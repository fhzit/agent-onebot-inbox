import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_CAPABILITIES, ADMIN_ROLE_CAPABILITY_MATRIX, ADMIN_ROLES, authorizeAdminCapability } from '../src/admin-authorization.js';

describe('admin authorization capability matrix', () => {
  it('declares explicit role grants and matches them exactly', () => {
    assert.deepEqual([...ADMIN_ROLES], ['viewer', 'operator', 'administrator']);
    assert.deepEqual(ADMIN_ROLE_CAPABILITY_MATRIX.viewer, ['admin.dashboard.read', 'admin.inbox.read', 'admin.contacts.read', 'admin.accounts.read', 'admin.audit.read']);
    assert.deepEqual(ADMIN_ROLE_CAPABILITY_MATRIX.operator, ['admin.dashboard.read', 'admin.inbox.read', 'admin.inbox.manage', 'admin.messages.send', 'admin.contacts.read', 'admin.accounts.read', 'admin.audit.read']);
    assert.deepEqual(ADMIN_ROLE_CAPABILITY_MATRIX.administrator, [...ADMIN_CAPABILITIES]);
    for (const role of ADMIN_ROLES) {
      const principal = { role, accountIds: ['acct-a'] };
      for (const capability of ADMIN_CAPABILITIES) {
        const expected = ADMIN_ROLE_CAPABILITY_MATRIX[role].includes(capability)
          && (!['admin.inbox.read', 'admin.inbox.manage', 'admin.messages.send', 'admin.contacts.read', 'admin.accounts.read', 'admin.accounts.manage'].includes(capability) || true);
        const result = authorizeAdminCapability(principal, capability,
          ['admin.inbox.read', 'admin.inbox.manage', 'admin.messages.send', 'admin.contacts.read', 'admin.accounts.read', 'admin.accounts.manage'].includes(capability) ? 'acct-a' : undefined);
        assert.equal(result, expected, `${role} -> ${capability}`);
      }
    }
  });

  it('requires a matching explicit account scope for account-scoped capabilities', () => {
    const scoped = { role: 'administrator', accountIds: ['acct-a'] };
    assert.equal(authorizeAdminCapability(scoped, 'admin.messages.send', 'acct-a'), true);
    assert.equal(authorizeAdminCapability(scoped, 'admin.messages.send', 'acct-b'), false);
    assert.equal(authorizeAdminCapability(scoped, 'admin.messages.send'), false);
    assert.equal(authorizeAdminCapability({ role: 'administrator', accountIds: [] }, 'admin.accounts.manage', 'acct-a'), false);
    assert.equal(authorizeAdminCapability({ role: 'administrator', accountIds: ['*'] }, 'admin.accounts.manage', 'acct-z'), true);
  });

  it('denies unknown, malformed, absent, or out-of-scope principals and capabilities', () => {
    for (const principal of [undefined, null, {}, { role: 'root', accountIds: ['acct-a'] }, { role: 'administrator', accountIds: 'acct-a' }]) {
      assert.equal(authorizeAdminCapability(principal as never, 'admin.messages.send', 'acct-a'), false);
    }
    for (const capability of [undefined, null, '', 'admin.*', 'admin.superuser', 7]) {
      assert.equal(authorizeAdminCapability({ role: 'administrator', accountIds: ['acct-a'] }, capability), false);
    }
    assert.equal(authorizeAdminCapability({ role: 'viewer', accountIds: ['acct-a'] }, 'admin.messages.send', 'acct-a'), false);
    assert.equal(authorizeAdminCapability({ role: 'administrator', accountIds: ['acct-a'] }, 'admin.dashboard.read', 'acct-a'), false);
    assert.equal(authorizeAdminCapability({ role: 'administrator', accountIds: ['acct-a'] }, 'admin.dashboard.read'), true);
  });
});
