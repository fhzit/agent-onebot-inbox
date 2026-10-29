import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContactName } from '../src/contact-name-resolution.js';

const contacts = [
  { userId: '1001', displayName: 'Alex' },
  { userId: '1002', displayName: 'Bea' },
];

test('resolves exact user ID or display name case-insensitively', () => {
  assert.deepEqual(resolveContactName(contacts, ' alex '), { kind: 'resolved', userId: '1001' });
  assert.deepEqual(resolveContactName(contacts, '1002'), { kind: 'resolved', userId: '1002' });
});

test('does not guess when a name matches distinct contacts', () => {
  assert.deepEqual(resolveContactName([...contacts, { userId: '1003', displayName: 'Alex' }], 'Alex'), {
    kind: 'ambiguous', candidateCount: 2,
  });
});

test('deduplicates a contact matching both ID and display name', () => {
  assert.deepEqual(resolveContactName([{ userId: 'Alex', displayName: 'Alex' }], 'Alex'), {
    kind: 'resolved', userId: 'Alex',
  });
});

test('returns not-found for blank and unknown names', () => {
  assert.deepEqual(resolveContactName(contacts, ''), { kind: 'not-found' });
  assert.deepEqual(resolveContactName(contacts, 'alexander'), { kind: 'not-found' });
});
