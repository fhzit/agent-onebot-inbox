import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../src/normalize.js';
import { evaluateInboxRules } from '../src/inbox-rules.js';

const message = normalizeEvent('acct', 'onebot', 'ws', {
  post_type: 'message', message_type: 'group', self_id: 9, user_id: 22, group_id: 33,
  message: [{ type: 'text', data: { text: 'Please REVIEW this' } }, { type: 'at', data: { qq: '9' } }],
});
assert.ok(message);

test('inbox rules scope by account, conversation and sender and match keywords case-insensitively', () => {
  assert.deepEqual(evaluateInboxRules(message, [
    { id: 'match', accountIds: ['acct'], conversationTypes: ['group'], senderIds: ['22'], groupIds: ['33'], keywords: ['review'], atMe: true, action: 'require_reply' },
    { id: 'wrong-account', accountIds: ['other'], action: 'dismiss' },
    { id: 'wrong-group', groupIds: ['other'], action: 'urgent' },
  ]), [{ ruleId: 'match', action: 'require_reply' }]);
});

test('disabled and nonmatching rules do not apply; empty keyword never matches', () => {
  assert.deepEqual(evaluateInboxRules(message, [
    { id: 'disabled', enabled: false, action: 'urgent' },
    { id: 'empty', keywords: [''], action: 'dismiss' },
    { id: 'mention', atMe: true, keywords: ['absent'], action: 'mark_processed' },
  ]), []);
});

test('returns every matching action in configured order without mutating message', () => {
  const before = structuredClone(message);
  assert.deepEqual(evaluateInboxRules(message, [
    { id: 'urgent', keywords: ['please'], action: 'urgent' },
    { id: 'dismiss', conversationTypes: ['group'], action: 'dismiss' },
  ]), [{ ruleId: 'urgent', action: 'urgent' }, { ruleId: 'dismiss', action: 'dismiss' }]);
  assert.deepEqual(message, before);
});
