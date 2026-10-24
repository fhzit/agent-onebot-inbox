import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskExtraction } from '../src/task-extraction.js';

test('parses validated task extraction output and trims fields', () => {
  assert.deepEqual(parseTaskExtraction(JSON.stringify({ tasks: [{ title: '  Send report ', owner: ' Mei ', dueAt: '2026-11-03T10:00:00Z', evidence: 'send report by Tuesday' }] })), {
    tasks: [{ title: 'Send report', owner: 'Mei', dueAt: '2026-11-03T10:00:00Z', evidence: 'send report by Tuesday' }],
  });
});

test('rejects malformed JSON and invalid task data rather than guessing', () => {
  assert.equal(parseTaskExtraction('not json'), null);
  assert.equal(parseTaskExtraction('{"tasks":[{"title":""}]}'), null);
  assert.equal(parseTaskExtraction('{"tasks":[{"title":"Do it","dueAt":"next week"}]}'), null);
});

test('allows absent optional fields and empty task list', () => {
  assert.deepEqual(parseTaskExtraction('{"tasks":[]}'), { tasks: [] });
  assert.deepEqual(parseTaskExtraction('{"tasks":[{"title":"Follow up","evidence":"please follow up"}]}'), {
    tasks: [{ title: 'Follow up', evidence: 'please follow up' }],
  });
});
