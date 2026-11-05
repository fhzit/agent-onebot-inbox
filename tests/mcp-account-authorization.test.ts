import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedMcpAccountIds, isMcpAccountAuthorized } from '../src/mcp-account-authorization.js';

const accounts = [
  { id: 'alpha', enabled: true },
  { id: 'beta', enabled: true },
  { id: 'disabled', enabled: false },
];

test('authorizes only allowlisted and enabled account IDs', () => {
  assert.deepEqual(authorizedMcpAccountIds({ sub: 'user-1', accountIds: ['beta', 'disabled', 'missing'] }, accounts), ['beta']);
});

test('defaults to deny when principal or identity claim is absent or malformed', () => {
  assert.deepEqual(authorizedMcpAccountIds(undefined, accounts), []);
  assert.deepEqual(authorizedMcpAccountIds({ accountIds: ['alpha'] }, accounts), []);
  assert.deepEqual(authorizedMcpAccountIds({ sub: '  ', accountIds: ['alpha'] }, accounts), []);
  assert.deepEqual(authorizedMcpAccountIds({ sub: 'user-1' }, accounts), []);
  assert.deepEqual(authorizedMcpAccountIds({ sub: 'user-1', accountIds: 'alpha' }, accounts), []);
  assert.deepEqual(authorizedMcpAccountIds({ sub: 'user-1', accountIds: [null, 1] }, accounts), []);
});

test('account selection checks enabled status and exact allowlist membership', () => {
  const principal = { sub: 'user-1', accountIds: ['alpha', 'disabled'] };
  assert.equal(isMcpAccountAuthorized(principal, 'alpha', accounts), true);
  assert.equal(isMcpAccountAuthorized(principal, 'beta', accounts), false);
  assert.equal(isMcpAccountAuthorized(principal, 'disabled', accounts), false);
});
