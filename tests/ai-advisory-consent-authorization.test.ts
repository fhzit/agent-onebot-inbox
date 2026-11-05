import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeAiAdvisoryConsent } from '../src/ai-advisory-consent-authorization.js';

const accounts = [{ id: 'acct-1', enabled: true }, { id: 'acct-2', enabled: false }];
const principal = { sub: 'user-1', accountIds: ['acct-1'] };

for (const action of ['grant', 'revoke', 'query'] as const) {
  test(`authorizes ${action} only for an enabled account in the principal scope`, () => {
    assert.deepEqual(authorizeAiAdvisoryConsent(principal, action, 'acct-1', accounts), {
      allowed: true, actor: 'user-1', accountId: 'acct-1', action,
    });
    assert.deepEqual(authorizeAiAdvisoryConsent(principal, action, 'acct-2', accounts), { allowed: false });
    assert.deepEqual(authorizeAiAdvisoryConsent(principal, action, 'acct-3', accounts), { allowed: false });
  });
}

test('denies absent, malformed, or blank principals and missing account claims', () => {
  for (const invalid of [undefined, null, {}, { sub: '' }, { sub: '  ' }, { sub: ' user-1' }, { sub: 12 }, { sub: 'user-1', accountIds: 'acct-1' }, { sub: 'user-1', accountIds: [] }]) {
    assert.deepEqual(authorizeAiAdvisoryConsent(invalid, 'grant', 'acct-1', accounts), { allowed: false });
  }
});

test('denies malformed requests, invalid action, and unrecognized enabled account records', () => {
  for (const id of [undefined, null, '', ' acct-1', 1]) {
    assert.deepEqual(authorizeAiAdvisoryConsent(principal, 'query', id, accounts), { allowed: false });
  }
  assert.deepEqual(authorizeAiAdvisoryConsent(principal, 'other' as never, 'acct-1', accounts), { allowed: false });
  assert.deepEqual(authorizeAiAdvisoryConsent(principal, 'grant', 'acct-1', []), { allowed: false });
});
