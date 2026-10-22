import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyActionResponse, resolveReverseWsAccount } from '../src/reverse-ws.js';

const accounts = [
  { id: 'a', self_id: '101' },
  { id: 'b', self_id: '202' },
];

test('resolves explicit account path without self identity', () => {
  assert.deepEqual(resolveReverseWsAccount(accounts, 'a', undefined), { id: 'a', self_id: '101' });
});

test('shared endpoint requires self identity when multiple accounts exist', () => {
  assert.equal(resolveReverseWsAccount(accounts, undefined, undefined), null);
  assert.deepEqual(resolveReverseWsAccount(accounts, undefined, '202'), accounts[1]);
});

test('shared endpoint permits sole account without self identity', () => {
  assert.deepEqual(resolveReverseWsAccount([accounts[0]], undefined, undefined), accounts[0]);
});

test('explicit account path rejects conflicting self identity', () => {
  assert.equal(resolveReverseWsAccount(accounts, 'a', '202'), null);
});

test('only OneBot action response envelope with matching echo is classified as response', () => {
  assert.equal(classifyActionResponse({ status: 'ok', retcode: 0, data: {}, echo: 'x' }, 'x'), true);
  assert.equal(classifyActionResponse({ post_type: 'message', echo: 'x' }, 'x'), false);
  assert.equal(classifyActionResponse({ status: 'ok', echo: 'x' }, 'x'), false);
  assert.equal(classifyActionResponse({ status: 'ok', retcode: 0, echo: 'y' }, 'x'), false);
});
