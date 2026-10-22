import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveContact, type Contact } from '../src/contact-resolver.js';
const contacts: Contact[] = [
  { account_id: 'bot-a', qq_id: '1001', nickname: 'Alex', remark: 'Work Alex', card: 'Ops' },
  { account_id: 'bot-a', qq_id: '1002', nickname: 'Alex', remark: 'Alex home' },
  { account_id: 'bot-b', qq_id: '1001', nickname: 'Other Alex' },
];
test('matches an exact QQ ID only in the requested account', () => {
  assert.deepEqual(resolveContact(contacts, 'bot-a', '1001'), { status: 'resolved', contact: contacts[0], candidates: [contacts[0]] });
});
test('matches nickname, remark and card and returns ambiguity candidates', () => {
  const result = resolveContact(contacts, 'bot-a', 'Alex');
  assert.equal(result.status, 'ambiguous');
  if (result.status === 'ambiguous') assert.deepEqual(result.candidates, contacts.slice(0,2));
  assert.equal(resolveContact(contacts, 'bot-a', 'Work Alex').status, 'resolved');
  assert.equal(resolveContact(contacts, 'bot-a', 'Ops').status, 'resolved');
});
test('does not guess if absent or query is empty', () => {
  assert.deepEqual(resolveContact(contacts, 'bot-a', 'missing'), { status: 'not_found', contact: null, candidates: [] });
  assert.equal(resolveContact(contacts, 'bot-a', '  ').status, 'not_found');
});
