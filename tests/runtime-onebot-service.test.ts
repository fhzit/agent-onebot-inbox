import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuntimeOneBotService } from '../src/runtime-onebot-service.js';
import type { AccountConfig } from '../src/config.js';
import type { NormalizedMessage } from '../src/normalize.js';
import type { RuntimeStore } from '../src/postgres-store.js';

const account: AccountConfig = { id: 'a', alias: 'A', self_id: '10', provider: 'napcat', enabled: true, permission: 'direct' };
const saved = { id: 'a:req-1', account_id: 'a', direction: 'outgoing', client_request_id: 'req-1', conversation_id: 'a:private:20', conversation_type: 'private', peer_user_id: '20', group_id: null, plain_text: 'hello', raw_message: 'hello', segments: [{ type: 'text', data: { text: 'hello' } }], external_message_id: 'ext-1' } as unknown as NormalizedMessage;

test('durable send idempotency rejects reusing a request id with different content or target', async () => {
  let sends = 0;
  const store = { async list() { return [saved]; }, async addOutgoing() { throw new Error('must not write'); } } as unknown as RuntimeStore;
  const socket = { readyState: 1, send() { sends++; } };
  const service = new RuntimeOneBotService(new Map([['a', { account, socket, pending: new Map() }]]), store);
  await assert.rejects(service.sendMessage(account, 'private', '21', 'different', 'req-1'), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(sends, 0);
});

test('ledger pending claim blocks dispatch and completed claim returns cached provider message', async () => {
  let sends = 0;
  const store = { async list() { return []; }, async addOutgoing() { throw new Error('must not write'); } } as unknown as RuntimeStore;
  const peer = { account, socket: { readyState: 1, send() { sends++; } }, pending: new Map() };
  const pending = new RuntimeOneBotService(new Map([['a', peer]]), store, 15000, {
    async claim() { return { created: false, record: { state: 'pending', response: null } }; }, async complete() { throw new Error('not expected'); },
  });
  await assert.rejects(pending.sendMessage(account, 'private', '20', 'hello', 'req-pending'), { code: 'IDEMPOTENCY_IN_PROGRESS' });
  const cached = { ...saved, external_message_id: 'cached' };
  const completed = new RuntimeOneBotService(new Map([['a', peer]]), store, 15000, {
    async claim() { return { created: false, record: { state: 'complete', response: cached } }; }, async complete() { throw new Error('not expected'); },
  });
  assert.equal(await completed.sendMessage(account, 'private', '20', 'hello', 'req-complete'), cached);
  assert.equal(sends, 0);
});

test('saved outgoing request reconciles ledger before claiming', async () => {
  let claims = 0, completions = 0, writes = 0;
  const store = { async list() { return [saved]; }, async addOutgoing() { writes++; } } as unknown as RuntimeStore;
  const service = new RuntimeOneBotService(new Map(), store, 15000, {
    async claim() { claims++; throw new Error('must not claim'); },
    async complete(_account, _request, response) { completions++; assert.equal(response, saved); },
  });
  assert.equal(await service.sendMessage(account, 'private', '20', 'hello', 'req-1'), saved);
  assert.equal(claims, 0);
  assert.equal(completions, 1);
  assert.equal(writes, 0);
});

test('ledger completion failure reports sent but uncertain and saved retry reconciles', async () => {
  let sends = 0, shouldFailCompletion = true;
  const message = { ...saved, external_message_id: 'ext-new' };
  const store = { async list() { return sends ? [message] : []; }, async addOutgoing() { sends++; return { message }; } } as unknown as RuntimeStore;
  const ledger = {
    async claim() { return { created: true, record: { state: 'pending' as const, response: null } }; },
    async complete() { if (shouldFailCompletion) throw new Error('db unavailable'); },
  };
  const peer = { account, socket: { readyState: 1, send(data: string) { const frame = JSON.parse(data); queueMicrotask(() => peer.pending.get(frame.echo)?.({ status: 'ok', retcode: 0, data: { message_id: 'ext-new' } })); } }, pending: new Map<string, (value: unknown) => void>() };
  const service = new RuntimeOneBotService(new Map([['a', peer]]), store, 15000, ledger);
  await assert.rejects(service.sendMessage(account, 'private', '20', 'hello', 'req-1'), (error: any) => error.code === 'IDEMPOTENCY_OUTCOME_UNCERTAIN' && /sent/i.test(error.message) && /ledger/i.test(error.message));
  shouldFailCompletion = false;
  assert.equal(await service.sendMessage(account, 'private', '20', 'hello', 'req-1'), message);
  assert.equal(sends, 1);
});

test('provider failure after ledger claim leaves request pending and never auto-retries', async () => {
  let sends = 0, completed = 0, claims = 0;
  const ledger = {
    async claim() { claims++; return { created: claims === 1, record: { state: 'pending' as const, response: null } }; },
    async complete() { completed++; },
  };
  const peer = { account, socket: { readyState: 1, send(_data: string, callback: (error?: Error) => void) { sends++; callback(new Error('provider connection lost')); } }, pending: new Map() };
  const service = new RuntimeOneBotService(new Map([['a', peer]]), { async list() { return []; } } as unknown as RuntimeStore, 20, ledger);
  await assert.rejects(service.sendMessage(account, 'private', '20', 'hello', 'req-fail'));
  await assert.rejects(service.sendMessage(account, 'private', '20', 'hello', 'req-fail'), { code: 'IDEMPOTENCY_IN_PROGRESS' });
  assert.equal(sends, 1);
  assert.equal(completed, 0);
});
