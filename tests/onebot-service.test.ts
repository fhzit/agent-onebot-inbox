import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OneBotService } from '../src/onebot-service.js';
import { MessageStore } from '../src/store.js';
import type { AccountConfig } from '../src/config.js';

const account: AccountConfig = { id: 'a', alias: 'A', self_id: '10', provider: 'napcat', enabled: true, permission: 'direct' };
test('service sends through reverse peer, persists outgoing, and uses request ID idempotently', async () => {
  const store = new MessageStore(); const pending = new Map<string, (v: unknown) => void>();
  const sent: Array<Record<string, unknown>> = [];
  const peer = { account, socket: { readyState: 1, send(raw: string) { const request = JSON.parse(raw) as Record<string, unknown>; sent.push(request); const echo = String(request.echo); queueMicrotask(() => pending.get(echo)?.({ status: 'ok', retcode: 0, data: { message_id: 'ext-1' }, echo })); } }, pending };
  const peers = new Map<string, typeof peer>([['a', peer]]);
  const service = new OneBotService(peers, store);
  const first = await service.sendMessage(account, 'private', '20', 'hello', 'req-1');
  const retry = await service.sendMessage(account, 'private', '20', 'hello', 'req-1');
  assert.equal(first.external_message_id, 'ext-1'); assert.equal(retry.id, first.id);
  assert.equal(sent.length, 1); assert.equal(store.get(first.id)?.direction, 'outgoing');
});

test('service refuses revoking a message not known as own outgoing', async () => {
  const service = new OneBotService(new Map(), new MessageStore());
  assert.equal((await service.revokeMessage(account, 'others-id')).status, 'unsupported');
});
