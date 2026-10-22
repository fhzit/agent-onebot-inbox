import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContactsCache } from '../src/contacts-cache.js';

test('replaces per-account friends and groups and keeps accounts isolated', () => {
  const cache = new ContactsCache();
  cache.replaceFriends('a', [{ user_id: 1, nickname: 'Alice', remark: 'Work' }]);
  cache.replaceGroups('a', [{ group_id: 9, group_name: 'Team' }]);
  cache.replaceFriends('b', [{ user_id: 1, nickname: 'Bob' }]);
  assert.equal(cache.getFriend('a', '1')?.nickname, 'Alice');
  assert.equal(cache.getFriend('b', '1')?.nickname, 'Bob');
  assert.equal(cache.getFriend('c', '1'), undefined);
  assert.equal(cache.getGroup('a', '9')?.group_name, 'Team');
  cache.replaceFriends('a', []);
  assert.equal(cache.getFriend('a', '1'), undefined);
  assert.equal(cache.getFriend('b', '1')?.nickname, 'Bob');
});

test('replaces group members by group, exposes card for resolution, and does not cross accounts', () => {
  const cache = new ContactsCache();
  cache.replaceGroupMembers('a', '9', [{ user_id: 2, nickname: 'Pat', card: 'Captain' }]);
  cache.replaceGroupMembers('a', '10', [{ user_id: 3, nickname: 'Jo' }]);
  cache.replaceGroupMembers('b', '9', [{ user_id: 2, nickname: 'Other' }]);
  assert.equal(cache.getGroupMember('a', '9', '2')?.card, 'Captain');
  assert.equal(cache.resolve('a', 'Captain').status, 'resolved');
  assert.equal(cache.resolve('b', 'Captain').status, 'not_found');
  cache.replaceGroupMembers('a', '9', []);
  assert.equal(cache.getGroupMember('a', '9', '2'), undefined);
  assert.equal(cache.getGroupMember('a', '10', '3')?.nickname, 'Jo');
});
