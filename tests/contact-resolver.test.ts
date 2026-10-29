import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveContact } from '../src/contact-resolver.js';
import type { Contact } from '../src/contact-resolver.js';

const contacts: Contact[] = [
  { account_id: 'main', qq_id: '101', nickname: 'Zhang San', remark: '班长' },
  { account_id: 'school', qq_id: '202', nickname: 'Zhang San', remark: '同名好友' },
  { account_id: 'main', qq_id: '303', nickname: '李四', card: '数学老师', group_id: 'group-1' },
  { account_id: 'main', qq_id: '404', nickname: 'Four', remark: '101' },
];

test('resolver matches account-scoped qq id, nickname, remark and group card', () => {
  assert.equal(resolveContact(contacts, 'main', '101').contact?.qq_id, '101');
  assert.equal(resolveContact(contacts, 'main', '班长').contact?.qq_id, '101');
  assert.equal(resolveContact(contacts, 'main', '数学老师').contact?.qq_id, '303');
});

test('resolver returns ambiguity candidates and never picks a same-name contact', () => {
  const result = resolveContact(contacts, undefined, 'Zhang San');
  assert.equal(result.status, 'ambiguous'); assert.equal(result.candidates.length, 2);
  assert.equal(resolveContact(contacts, 'main', '张三').status, 'not_found');
  assert.equal(resolveContact(contacts, 'main', '101').contact?.qq_id, '101');
  assert.equal(resolveContact(contacts, 'main', ' 101 ').contact?.qq_id, '101');
  assert.equal(resolveContact(contacts, undefined, '101').status, 'resolved');
  assert.equal(resolveContact(contacts, 'main', 'not-a-number').status, 'not_found');
});
