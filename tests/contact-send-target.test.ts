import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveContactSendTarget } from '../src/contact-send-target.js';
import type { ContactSendTargetContact } from '../src/contact-send-target.js';

const contacts: ContactSendTargetContact[] = [
  { account_id: 'a', qq_id: '101', nickname: 'Alex' },
  { account_id: 'a', qq_id: '102', nickname: 'Alex' },
  { account_id: 'b', qq_id: '101', nickname: 'Other' },
];

test('keeps an explicit target ID authoritative without requiring a contact match', () => {
  assert.deepEqual(resolveContactSendTarget({ accountId: 'a', explicitTargetId: ' 909 ', contacts }), {
    status: 'resolved', targetId: '909', source: 'explicit',
  });
});

test('resolves a recipient only against the selected account and reports ambiguity', () => {
  assert.deepEqual(resolveContactSendTarget({ accountId: 'a', recipient: 'Other', contacts }), {
    status: 'not_found', targetId: null,
  });
  assert.equal(resolveContactSendTarget({ accountId: 'a', recipient: 'Alex', contacts }).status, 'ambiguous');
  assert.equal(resolveContactSendTarget({ accountId: 'b', recipient: '101', contacts }).status, 'resolved');
});

test('explicit target survives an unknown accompanying recipient, but known conflicts mismatch', () => {
  assert.deepEqual(resolveContactSendTarget({ accountId: 'a', explicitTargetId: '909', recipient: 'Unknown', contacts }), {
    status: 'resolved', targetId: '909', source: 'explicit',
  });
  assert.deepEqual(resolveContactSendTarget({ accountId: 'a', explicitTargetId: '909', recipient: '101', contacts }), {
    status: 'mismatch', targetId: null,
  });
  assert.deepEqual(resolveContactSendTarget({ accountId: 'a', explicitTargetId: '909', recipient: 'Alex', contacts }), {
    status: 'ambiguous', targetId: null,
  });
});

test('requires explicit ID and recipient to agree when both are supplied', () => {
  assert.deepEqual(resolveContactSendTarget({ accountId: 'a', explicitTargetId: '102', recipient: '101', contacts }), {
    status: 'mismatch', targetId: null,
  });
  assert.equal(resolveContactSendTarget({ accountId: 'a', explicitTargetId: '101', recipient: '101', contacts }).status, 'resolved');
});

test('rejects empty or multiple explicit IDs and empty recipients', () => {
  for (const explicitTargetId of ['', '  ', '1,2', '1 2', '1;2']) {
    assert.equal(resolveContactSendTarget({ accountId: 'a', explicitTargetId, contacts }).status, 'invalid');
  }
  assert.equal(resolveContactSendTarget({ accountId: 'a', recipient: '  ', contacts }).status, 'invalid');
  assert.equal(resolveContactSendTarget({ accountId: 'a', contacts }).status, 'invalid');
});
