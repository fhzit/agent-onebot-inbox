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
  const store = {
    async list() { return [saved]; },
    async addOutgoing() { throw new Error('must not write'); },
  } as unknown as RuntimeStore;
  const socket = { readyState: 1, send() { sends++; } };
  const service = new RuntimeOneBotService(new Map([['a', { account, socket, pending: new Map() }]]), store);
  await assert.rejects(service.sendMessage(account, 'private', '21', 'different', 'req-1'), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(sends, 0);
});
