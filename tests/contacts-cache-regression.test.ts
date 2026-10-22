import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContactsCache } from '../src/contacts-cache.js';

test('clearing one group does not leave prior member cards in contact resolution', () => {
  const cache = new ContactsCache();
  cache.replaceGroupMembers('account', 'group', [{ user_id: '44', nickname: 'Casey', card: 'Old card' }]);
  cache.replaceGroupMembers('account', 'group', []);
  assert.equal(cache.resolve('account', 'Old card').status, 'not_found');
});

test('same member in two groups creates ambiguity for a shared card query', () => {
  const cache = new ContactsCache();
  cache.replaceGroupMembers('account', 'g1', [{ user_id: '44', nickname: 'Casey', card: 'Captain' }]);
  cache.replaceGroupMembers('account', 'g2', [{ user_id: '44', nickname: 'Casey', card: 'Captain' }]);
  const result = cache.resolve('account', 'Captain');
  assert.equal(result.status, 'ambiguous');
  if (result.status === 'ambiguous') assert.equal(result.candidates.length, 2);
});
