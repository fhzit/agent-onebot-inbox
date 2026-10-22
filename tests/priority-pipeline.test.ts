import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { applyPriority } from '../src/priority.js';

test('normalized inbox message priority is driven by configured user rules', () => {
  const message = normalizeEvent('school', 'napcat', 'fixture', { post_type: 'message', message_type: 'private', self_id: '100', user_id: '200', message_id: 'm1', time: 1700000000, message: 'Please submit this tomorrow' })!;
  const scored = applyPriority(message, {
    rules: [{ id: 'teacher', kind: 'weighted', senderIds: ['200'], weight: 30 }],
    watchPeople: [],
  });
  assert.equal(scored.priority_score, 45);
  assert.equal(scored.priority, 'P2');
});
