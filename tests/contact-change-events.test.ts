import assert from 'node:assert/strict';
import test from 'node:test';
import { mapContactChangeEvent } from '../src/contact-change-events.js';

test('friend changes refresh friend snapshot only for notice envelopes', () => {
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'friend_add' }), [{ kind: 'friends' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'friend_recall' }), [{ kind: 'friends' }]);
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

test('group metadata and role changes refresh only identifiable group members', () => {
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_admin', group_id: 10 }), [{ kind: 'members', group_id: '10' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_ban', group_id: 10 }), [{ kind: 'members', group_id: '10' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_card', group_id: 10 }), [{ kind: 'members', group_id: '10' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_name' }), [{ kind: 'groups' }]);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_increase' }), []);
});

test('unrelated or unsupported event types do not trigger synchronization', () => {
  assert.deepEqual(mapContactChangeEvent({ post_type: 'meta_event', notice_type: 'friend_add' }), []);
  assert.deepEqual(mapContactChangeEvent({ post_type: 'notice', notice_type: 'group_upload', group_id: 10 }), []);
});
