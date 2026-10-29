import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLE_CAPABILITIES, ROLE_CAPABILITY_POLICY, USER_ROLES, roleHasCapability } from '../src/role-capability-policy.js';

describe('role capability policy', () => {
  it('declares a compact explicit policy and grants exactly its entries', () => {
    assert.deepEqual([...USER_ROLES], ['reader', 'operator', 'admin']);
    assert.deepEqual(ROLE_CAPABILITY_POLICY.reader, ['inbox.read', 'contacts.read', 'history.read']);
    assert.deepEqual(ROLE_CAPABILITY_POLICY.operator, ['inbox.read', 'inbox.process', 'message.send', 'contacts.read', 'history.read']);
    assert.deepEqual(ROLE_CAPABILITY_POLICY.admin, [...ROLE_CAPABILITIES]);
    for (const role of USER_ROLES) {
      for (const capability of ROLE_CAPABILITIES) {
        assert.equal(roleHasCapability(role, capability), ROLE_CAPABILITY_POLICY[role].includes(capability), `${role} -> ${capability}`);
      }
    }
  });

  it('defaults to deny for unknown, malformed, and absent values', () => {
    for (const role of [undefined, null, '', 'owner', 'Admin', 1, {}]) {
      assert.equal(roleHasCapability(role, 'inbox.read'), false);
    }
    for (const capability of [undefined, null, '', 'inbox.*', 'accounts.delete', 1, {}]) {
      assert.equal(roleHasCapability('admin', capability), false);
    }
    assert.equal(roleHasCapability('reader', 'message.send'), false);
    assert.equal(roleHasCapability('operator', 'accounts.manage'), false);
  });
});
