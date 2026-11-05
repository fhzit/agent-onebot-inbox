import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedMcpAccountIds, isMcpAccountAuthorized } from '../src/mcp-account-authorization.js';

const principal = (accountIds: unknown, sub: unknown = 'user-1') => ({ sub, accountIds });

test('malformed account lists fail closed without throwing', () => {
  const malformed = [null, undefined, 'alpha', 42, {}, { id: 'alpha' }, { id: 'alpha', enabled: true }];
  for (const accounts of malformed) {
    assert.doesNotThrow(() => authorizedMcpAccountIds(principal(['alpha']), accounts as never));
    assert.deepEqual(authorizedMcpAccountIds(principal(['alpha']), accounts as never), []);
  }
});

test('duplicate account IDs cannot produce duplicate authorization results', () => {
  const accounts = [
    { id: 'alpha', enabled: true },
    { id: 'alpha', enabled: true },
  ];
  assert.deepEqual(authorizedMcpAccountIds(principal(['alpha']), accounts), ['alpha']);
});

test('principal claims must be own properties, not inherited prototype data', () => {
  const inherited = Object.create({ sub: 'user-1', accountIds: ['alpha'] });
  assert.deepEqual(authorizedMcpAccountIds(inherited, [{ id: 'alpha', enabled: true }]), []);
});

test('account IDs must be valid nonempty strings and enabled must be explicit', () => {
  const accounts = [
    { id: '', enabled: true },
    { id: '  ', enabled: true },
    { id: 'alpha', enabled: true },
    { id: 'alpha', enabled: true },
    { id: 'disabled', enabled: false },
    { id: '__proto__', enabled: true },
    { id: 'constructor', enabled: true },
    { id: 'toString', enabled: true },
  ];
  assert.deepEqual(authorizedMcpAccountIds(principal(['', '  ', 'alpha', 'disabled', '__proto__', 'constructor', 'toString']), accounts), ['alpha', '__proto__', 'constructor', 'toString']);
});

test('invalid runtime account object IDs do not authorize through coercion', () => {
  const accounts = [
    { id: 17, enabled: true },
    { id: null, enabled: true },
    { id: { toString: () => 'alpha' }, enabled: true },
  ];
  assert.equal(isMcpAccountAuthorized(principal(['alpha']), 'alpha', accounts as never), false);
});

test('non-string and empty account claims are ignored', () => {
  const claims = [null, 1, {}, '', '  ', 'alpha'];
  const accounts = [{ id: 'alpha', enabled: true }, { id: '', enabled: true }, { id: '  ', enabled: true }];
  assert.deepEqual(authorizedMcpAccountIds(principal(claims), accounts), ['alpha']);
});
