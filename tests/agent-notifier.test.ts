import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { HermesWebhookNotifier, type AgentNotification, type FetchLike } from '../src/agent-notifier.js';

const event: AgentNotification = {
  event: 'message.received', account: 'qq-work', message_id: '42', priority: 'P1',
  sender: 'Alice', conversation: 'group:7', preview: 'Can you review this?', reason: 'high priority',
};

test('Hermes notifier signs V2 timestamp.body and sends only compact allowlisted payload', async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fakeFetch: FetchLike = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(null, { status: 200 });
  };
  await new HermesWebhookNotifier({ url: 'http://localhost/webhooks/inbox', secret: 'test-secret', timeoutMs: 500, fetch: fakeFetch }).notify(event);
  assert.ok(seen);
  assert.equal(seen.url, 'http://localhost/webhooks/inbox');
  assert.equal(seen.init?.method, 'POST');
  const body = String(seen.init?.body);
  const payload = JSON.parse(body);
  assert.deepEqual(Object.keys(payload), ['event', 'account', 'message_id', 'priority', 'sender', 'conversation', 'preview', 'reason']);
  assert.equal(payload.preview, event.preview);
  assert.equal(body.includes('raw_message'), false);
  assert.equal(body.includes('full chat'), false);
  const headers = new Headers(seen.init?.headers);
  const timestamp = headers.get('X-Webhook-Timestamp');
  assert.ok(timestamp);
  const expected = createHmac('sha256', 'test-secret').update(`${timestamp}.${body}`).digest('hex');
  assert.equal(headers.get('X-Webhook-Signature-V2'), expected);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(seen.init?.signal instanceof AbortSignal, true);
});

test('Hermes notifier rejects non-success responses without exposing payload or secret', async () => {
  const notifier = new HermesWebhookNotifier({ url: 'http://localhost/webhooks/inbox', secret: 'private-secret', timeoutMs: 500, fetch: async () => new Response(null, { status: 401 }) });
  await assert.rejects(notifier.notify(event), (error: Error) => {
    assert.match(error.message, /HTTP 401/);
    assert.equal(error.message.includes('private-secret'), false);
    assert.equal(error.message.includes(event.preview), false);
    return true;
  });
});

test('Hermes notifier requires explicit positive timeout and secret', () => {
  assert.throws(() => new HermesWebhookNotifier({ url: 'http://localhost', secret: 'x', timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => new HermesWebhookNotifier({ url: 'http://localhost', secret: '', timeoutMs: 100 }), /secret/);
});

test('Hermes notifier aborts timed-out requests', async () => { const notifier=new HermesWebhookNotifier({url:'http://localhost/hook',secret:'x',timeoutMs:5,fetch:async (_url,init)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))))}); await assert.rejects(notifier.notify(event),/aborted/); });
