import assert from 'node:assert/strict';
import test from 'node:test';
import { mapContactChangeEvent, syncContactChangeEvent } from '../src/contact-change-events.js';

const account = { id: 'account-alpha' } as import('../src/config.js').AccountConfig;

test('friend changes refresh friend snapshot only for notice envelopes', () => {
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'friend_add' }), [{ kind: 'friends' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'friend_recall' }), [{ kind: 'friends' }]);
  for (const notice_type of ['friend_add', 'friend_recall']) {
    assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type, self_id: '123', user_id: '456' }), [{ kind: 'friends' }]);
  }
  assert.deepEqual(mapContactChangeEvent({ post_type: 'message', notice_type: 'friend_add' }), []);
});

test('group membership changes refresh groups and that group member snapshot', () => {
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_increase', group_id: 123 }), [
    { kind: 'groups' }, { kind: 'members', group_id: '123' },
  ]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_decrease', sub_type: 'kick', group_id: '456' }), [
    { kind: 'groups' }, { kind: 'members', group_id: '456' },
  ]);
});

test('group entry and leave subtypes map to the same scoped snapshots', () => {
  for (const notice_type of ['group_increase', 'group_decrease']) {
    for (const sub_type of ['approve', 'invite', 'leave', 'kick', 'kick_me']) {
      assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type, sub_type, group_id: '007' }), [
        { kind: 'groups' }, { kind: 'members', group_id: '7' },
      ], `${notice_type}/${sub_type}`);
    }
  }
});

test('group metadata and role changes refresh only identifiable group members', () => {
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_admin', group_id: 10 }), [{ kind: 'members', group_id: '10' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_ban', group_id: 10 }), [{ kind: 'members', group_id: '10' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_card', group_id: 10 }), [{ kind: 'members', group_id: '10' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_name' }), [{ kind: 'groups' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_increase' }), []);
});

test('unsupported envelopes and malformed or oversized group identifiers are ignored', () => {
  for (const event of [null, [], 'notice', { post_type: 'notice', notice_type: 5 },
    { post_type: 'meta_event', notice_type: 'friend_add' },
    { post_type: 'notice', notice_type: 'group_upload', group_id: 10 },
    { post_type: 'notice', notice_type: 'group_card', group_id: -1 },
    { post_type: 'notice', notice_type: 'group_card', group_id: 1.5 },
    { post_type: 'notice', notice_type: 'group_card', group_id: '1x' },
    { post_type: 'notice', notice_type: 'group_card', group_id: '9'.repeat(65) },
    { post_type: 'notice', notice_type: 'group_card', group_id: '9007199254740992' }]) {
    assert.deepEqual(mapContactChangeEvent(event), []);
  }
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_card', group_id: '00042' }), [{ kind: 'members', group_id: '42' }]);
});

test('sync invokes only validated requests with the explicitly supplied account', async () => {
  const calls: unknown[][] = [];
  const count = await syncContactChangeEvent(account, { post_type: 'notice', notice_type: 'group_increase', group_id: '23' }, async (scope, request) => {
    calls.push([scope, request]);
  });
  assert.equal(count, 2);
  assert.deepEqual(calls, [[account, { kind: 'groups' }], [account, { kind: 'members', group_id: '23' }]]);

  const otherAccount = { id: 'account-beta' } as import('../src/config.js').AccountConfig;
  const scopeCalls: unknown[][] = [];
  await syncContactChangeEvent(otherAccount, { post_type: 'notice', notice_type: 'group_card', group_id: 23 }, async (scope, request) => {
    scopeCalls.push([scope.id, request]);
  });
  assert.deepEqual(scopeCalls, [['account-beta', { kind: 'members', group_id: '23' }]]);

  const perListCalls: unknown[][] = [];
  await syncContactChangeEvent(account, { post_type: 'notice', notice_type: 'group_increase', group_id: '23' }, async (scope, request) => {
    perListCalls.push([scope.id, request]);
  });
  await syncContactChangeEvent(account, { post_type: 'notice', notice_type: 'group_card', group_id: '24' }, async (scope, request) => {
    perListCalls.push([scope.id, request]);
  });
  assert.deepEqual(perListCalls, [
    ['account-alpha', { kind: 'groups' }], ['account-alpha', { kind: 'members', group_id: '23' }],
    ['account-alpha', { kind: 'members', group_id: '24' }],
  ]);

  assert.equal(await syncContactChangeEvent(account, { post_type: 'notice', notice_type: 'group_card', group_id: {} }, async () => { throw new Error('must not call'); }), 0);
  await assert.rejects(syncContactChangeEvent(account, { post_type: 'notice', notice_type: 'friend_add' }, async () => { throw new Error('store failed'); }), /store failed/);
});
