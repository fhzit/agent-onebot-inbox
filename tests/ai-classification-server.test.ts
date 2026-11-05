import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { startServer } from '../src/server.js';
import type { MessageClassifier } from '../src/ai-classification.js';

function runMainWithClassifierEndpoint(endpoint: string) {
  const script = `process.env.AI_ADVISORIES_ENABLED = 'true'; process.env.AI_CLASSIFIER_ENDPOINT = ${JSON.stringify(endpoint)}; process.env.AI_CLASSIFIER_MODEL = 'model'; process.env.AI_ADVISORY_ACCOUNT_IDS = 'account'; process.env.AI_ADVISORY_LABELS = 'label'; process.env.DATABASE_URL = 'postgres://unused'; await import('./src/main.ts');`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' });
  return result;
}

test('main rejects classifier endpoints without HTTPS before starting providers', () => {
  for (const endpoint of ['http://classifier.example/v1/chat/completions', 'not-a-url']) {
    const result = runMainWithClassifierEndpoint(endpoint);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AI_CLASSIFIER_ENDPOINT must (use HTTPS|be a valid HTTPS URL)/);
  }
});

const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };
const config = { host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] };
const event = (id: number, message = 'hello') => ({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: id, time: 1700000000, message });
const policy = { enabled: true, labels: ['greeting', 'other'] };

function baseUrls(runtime: Awaited<ReturnType<typeof startServer>>) {
  const address = runtime.address();
  assert.ok(address && typeof address !== 'string');
  return { httpUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}` };
}

test('HTTP ingress invokes opted-in classifier once; duplicate ingress remains one stored message', async () => {
  let calls = 0;
  const classifier: MessageClassifier = { async classify(input) { calls++; assert.deepEqual(input, { messageId: 'main:42:71', text: 'hello', labels: ['greeting', 'other'] }); return { label: 'greeting', confidence: 0.95 }; } };
  const runtime = await startServer(config, undefined, undefined, { aiClassification: { enabled: true, policy, classifier } });
  const { httpUrl } = baseUrls(runtime);
  try {
    const headers = { authorization: 'Bearer transport-secret', 'content-type': 'application/json' };
    const body = JSON.stringify(event(71));
    const first = await fetch(`${httpUrl}/onebot/v11/events/main`, { method: 'POST', headers, body });
    assert.equal(first.status, 200);
    const second = await fetch(`${httpUrl}/onebot/v11/events/main`, { method: 'POST', headers, body });
    assert.equal(second.status, 200);
    assert.equal(calls, 1, 'duplicate ingress must not invoke the provider');
    assert.equal(runtime.store.list('main').length, 1);
    const stored = runtime.store.list('main')[0]!;
    assert.ok(!('ai_advisory' in stored), 'classification advisory must remain transient');
    assert.deepEqual(runtime.store.state(stored.id), { unread: true, seen_by_agent: false, processed: false, dismissed: false, qq_read: false });
  } finally { await runtime.close(); }
});

test('WebSocket ingress keeps advisory transient and dedupes', async () => {
  const seen: unknown[] = [];
  const classifier: MessageClassifier = { async classify(input) { seen.push(input); return { label: 'other', confidence: 0.91 }; } };
  const runtime = await startServer(config, undefined, undefined, { aiClassification: { enabled: true, policy, classifier } });
  const { wsUrl } = baseUrls(runtime);
  let ws: WebSocket | undefined;
  try {
    ws = new WebSocket(`${wsUrl}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject); });
    ws.send(JSON.stringify(event(72, 'ws hello')));
    for (let i = 0; i < 50 && runtime.store.list('main').length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
    ws.send(JSON.stringify(event(72, 'ws hello')));
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(seen.length, 1, 'duplicate WebSocket ingress must not invoke the provider');
    assert.deepEqual(seen, [{ messageId: 'b09e6d5a9b3c68bea08da075a802edb9d85637c9d037ed4be392e7757348d4c0', text: 'ws hello', labels: ['greeting', 'other'] }]);
    const stored = runtime.store.list('main')[0]!;
    assert.ok(!('ai_advisory' in stored), 'classification advisory must not mutate the stored message');
    assert.deepEqual(runtime.store.state(stored.id), { unread: true, seen_by_agent: false, processed: false, dismissed: false, qq_read: false });
  } finally { ws?.close(); await runtime.close(); }
});

test('HTTP and WebSocket ingress do not call classifier without AI opt-in', async () => {
  let calls = 0;
  const classifier: MessageClassifier = { async classify() { calls++; return { label: 'greeting', confidence: 0.99 }; } };
  const runtime = await startServer(config);
  const { httpUrl, wsUrl } = baseUrls(runtime);
  let ws: WebSocket | undefined;
  try {
    await fetch(`${httpUrl}/onebot/v11/events/main`, { method: 'POST', headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' }, body: JSON.stringify(event(73)) });
    ws = new WebSocket(`${wsUrl}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject); });
    ws.send(JSON.stringify(event(74)));
    for (let i = 0; i < 50 && runtime.store.list('main').length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 0);
    assert.equal(runtime.store.list('main').length, 2);
    assert.ok(runtime.store.list('main').every(message => !('ai_advisory' in message)));
  } finally { ws?.close(); await runtime.close(); }
});

test('classifier rejection is fail-open for HTTP and WebSocket while messages remain stored', async () => {
  const classifier: MessageClassifier = { async classify() { throw new Error('classifier unavailable'); } };
  const runtime = await startServer(config, undefined, undefined, { aiClassification: { enabled: true, policy, classifier } });
  const { httpUrl, wsUrl } = baseUrls(runtime);
  let ws: WebSocket | undefined;
  try {
    const response = await fetch(`${httpUrl}/onebot/v11/events/main`, { method: 'POST', headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' }, body: JSON.stringify(event(75, 'http classifier failure')) });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { status: string }).status, 'stored');
    ws = new WebSocket(`${wsUrl}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject); });
    ws.send(JSON.stringify(event(76, 'ws classifier failure')));
    for (let i = 0; i < 50 && runtime.store.list('main').length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(runtime.store.list('main').length, 2);
    assert.deepEqual(new Set(runtime.store.list('main').map(message => message.plain_text)), new Set(['http classifier failure', 'ws classifier failure']));
  } finally { ws?.close(); await runtime.close(); }
});
