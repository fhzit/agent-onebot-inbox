import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePriority, type PriorityInput } from '../src/priority.js';

const message: PriorityInput = { accountId: 'a', conversationType: 'group', groupId: 'g', senderId: 'u', text: 'Please review launch', atMe: false, atAll: false };

test('rules match account scope and keyword, accumulating configured weights', () => {
 const result = scorePriority(message, { rules: [{ id: 'kw', weight: 30, keywords: ['launch'] }, { id: 'wrong-account', weight: 80, accountIds: ['b'], keywords: ['launch'] }], watchPeople: [] });
 assert.equal(result.score, 30); assert.equal(result.priority, 'P3'); assert.deepEqual(result.matchedRules, ['kw']);
});
test('watched sender boosts score only within configured account scope', () => {
 const result = scorePriority(message, { rules: [], watchPeople: [{ userId: 'u', boost: 20, accountIds: ['a'] }] });
 assert.equal(result.score, 20); assert.equal(result.priority, 'P3');
});
test('explicit user override wins over computed score', () => {
 const result = scorePriority({ ...message, override: { priority: 'P0' } }, { rules: [], watchPeople: [] });
 assert.equal(result.priority, 'P0'); assert.equal(result.score, 100);
});
test('@all is never treated as at-me for scoring', () => {
 const result = scorePriority({ ...message, atMe: true, atAll: true }, { rules: [{ id: 'mention', weight: 25, atMe: true }], watchPeople: [] });
 assert.equal(result.score, 0);
});
test('hard user rule overrides scoring regardless of matching weighted rules', () => {
 const result = scorePriority({ ...message, senderId: 'blocked' }, { rules: [{ id: 'force', kind: 'hard', priority: 'P0', senderIds: ['blocked'] }], watchPeople: [] });
 assert.equal(result.priority, 'P0'); assert.equal(result.score, 100); assert.equal(result.overridden, true);
});
test('score clamps and maps P0-P4 deterministically', () => {
 for (const [score, priority] of [[80,'P0'],[60,'P1'],[35,'P2'],[15,'P3'],[0,'P4']] as const) assert.equal(scorePriority({ ...message, baseScore: score }, { rules: [], watchPeople: [] }).priority, priority);
});
