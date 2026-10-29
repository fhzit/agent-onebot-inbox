import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const account = (action_url: unknown) => ({ id: 'a', alias: 'A', self_id: '1', provider: 'napcat', action_url });
const load = (action_url: unknown) => loadConfig({ ACCOUNTS_JSON: JSON.stringify([account(action_url)]) });

test('action_url accepts ordinary HTTP and HTTPS endpoints', () => {
  assert.equal(load('http://bot.example:3000/api').accounts[0]?.action_url, 'http://bot.example:3000/api');
  assert.equal(load('https://bot.example/api').accounts[0]?.action_url, 'https://bot.example/api');
});

test('action_url rejects unsupported protocols', () => {
  assert.throws(() => load('ftp://bot.example/api'), /action_url.*http or https/i);
});

test('action_url rejects embedded credentials', () => {
  assert.throws(() => load('https://user:pass@bot.example/api'), /action_url.*credentials/i);
});

test('action_url rejects empty hosts and invalid ports', () => {
  assert.throws(() => load('http://bot.example:65536/api'), /action_url/i);
  assert.throws(() => load('http://bot.example:/api'), /action_url/i);
});

test('action_url rejects query strings and fragments', () => {
  assert.throws(() => load('http://bot.example/api?token=x'), /action_url.*query/i);
  assert.throws(() => load('http://bot.example/api#fragment'), /action_url.*fragment/i);
});

test('action_url rejects non-string values', () => {
  assert.throws(() => load({ url: 'http://bot.example' }), /action_url.*string/i);
});
