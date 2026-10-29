import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';
import { enqueueNotificationSafely, startNotificationReconciliation } from '../src/server.js';
import type { PriorityConfig } from '../src/priority.js';

const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };

test('notification enqueue failure is logged without rejecting ingress work', async () => {
  const logs: unknown[] = [];
  const result = await enqueueNotificationSafely(async () => { throw new Error('queue offline'); }, { warn: (data) => logs.push(data) }, { account_id: 'main', message_id: 'm1' });
  assert.equal(result, false);
  assert.equal(logs.length, 1);
});

test('notification reconciliation is bounded, single-flight, and stops cleanly', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const outbox = { async reconcile(options: { limit?: number; maxAttempts?: number }) { calls++; assert.deepEqual(options, { limit: 100, maxAttempts: 5 }); await gate; return []; } };
  const stop = startNotificationReconciliation(outbox, { info() {}, warn() {} }, 5);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 1);
  release();
  await stop();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 1);
});

test('notification reconciliation contains errors and remains stoppable', async () => {
  const warnings: unknown[] = [];
  const stop = startNotificationReconciliation({ async reconcile() { throw new Error('database unavailable'); } }, { info() {}, warn(data) { warnings.push(data); } }, 5);
  await new Promise(resolve => setTimeout(resolve, 10));
  await stop();
  assert.ok(warnings.length >= 1);
});

test('HTTP and WebSocket ingress apply injected priority rules', async () => {
  const port = 23000 + Math.floor(Math.random() * 1000);
  const priorityConfig: PriorityConfig = { rules: [{ id: 'urgent-keyword', keywords: ['urgent'], weight: 50 }], watchPeople: [] };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] }, undefined, priorityConfig);
  try {
    const headers = { authorization: 'Bearer transport-secret', 'content-type': 'application/json' };
    const event = (id: number) => ({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: id, time: 1700000000, message: 'urgent please' });
    await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify(event(50)) });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify(event(51)));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(runtime.store.list('main').map(m => [m.priority, m.priority_score]), [['P1', 65], ['P1', 65]]);
    ws.close();
  } finally { await runtime.close(); }
});

test('HTTP ingress applies configured inbox state rules without changing QQ read status', async () => {
  const port = 24000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] }, undefined, undefined, { inboxRules: [{ id: 'auto-process', keywords: ['archive'], action: 'mark_processed' }] });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' }, body: JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: 22, time: 1700000000, message: 'please archive this' }) });
    assert.equal(response.status, 200);
    const stored = runtime.store.list('main')[0]!;
    assert.deepEqual(runtime.store.state(stored.id), { unread: false, seen_by_agent: true, processed: true, dismissed: false, qq_read: false });
  } finally { await runtime.close(); }
});

test('inbox rules API is authenticated, validates, and changes ingress behavior', async () => {
  const port = 25000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: 'Bearer api-secret', 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(`${base}/api/admin/inbox-rules`)).status, 401);
    const initial = await fetch(`${base}/api/admin/inbox-rules`, { headers });
    assert.deepEqual(await initial.json(), { rules: [] });
    const invalid = await fetch(`${base}/api/admin/inbox-rules`, { method: 'PUT', headers, body: JSON.stringify({ rules: [{ id: 'bad', action: 'snooze' }] }) });
    assert.equal(invalid.status, 400);
    const savedRules = [{ id: 'archive', keywords: ['archive'], action: 'mark_processed' }];
    const saved = await fetch(`${base}/api/admin/inbox-rules`, { method: 'PUT', headers, body: JSON.stringify({ rules: savedRules }) });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { rules: savedRules });
    const readback = await fetch(`${base}/api/admin/inbox-rules`, { headers });
    assert.deepEqual(await readback.json(), { rules: savedRules });
    const ingress = await fetch(`${base}/onebot/v11/events/main`, { method: 'POST', headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' }, body: JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: 225, time: 1700000000, message: 'please archive this' }) });
    assert.equal(ingress.status, 200);
    const stored = runtime.store.list('main')[0]!;
    assert.equal(runtime.store.state(stored.id).processed, true);
  } finally { await runtime.close(); }
});

test('HTTP event endpoint authenticates, routes, and deduplicates messages', async () => {
  const port = 20000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const event = { post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: 5, time: 1700000000, message: 'hi' };
    const denied = await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', body: JSON.stringify(event) });
    assert.equal(denied.status, 401);
    const headers = { authorization: 'Bearer transport-secret', 'content-type': 'application/json' };
    const first = await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify(event) });
    const second = await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, { method: 'POST', headers, body: JSON.stringify(event) });
    assert.equal((await first.json() as { status: string }).status, 'stored');
    assert.equal((await second.json() as { status: string }).status, 'duplicate');
    assert.equal(runtime.store.list('main').length, 1);
    const stored = runtime.store.list('main')[0]!;
    assert.equal(runtime.store.state(stored.id).unread, true);
    assert.equal(runtime.store.state(stored.id).qq_read, false);
    const deniedState = await fetch(`http://127.0.0.1:${port}/api/messages/mark_processed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message_id: stored.id }) });
    assert.equal(deniedState.status, 401);
    const processed = await fetch(`http://127.0.0.1:${port}/api/messages/mark_processed`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify({ message_id: stored.id }) });
    const state = await processed.json() as { state: { unread: boolean; seen_by_agent: boolean; processed: boolean; qq_read: boolean } };
    assert.equal(processed.status, 200);
    assert.deepEqual(state.state, { unread: false, seen_by_agent: true, processed: true, dismissed: false, qq_read: false });
  } finally { await runtime.close(); }
});

test('configuration refuses duplicate QQ identity', () => {
  const env = { ACCOUNTS_JSON: JSON.stringify([{ id: 'one', alias: 'One', self_id: '11', provider: 'napcat' }, { id: 'two', alias: 'Two', self_id: '11', provider: 'snowluma' }]) };
  assert.throws(() => loadConfig(env), /Duplicate self_id/);
});

test('reverse WebSocket event ingests into account-specific inbox', async () => {
  // Server accepts fixed port; this probe is intentionally isolated to loopback.
  const port = 19000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: 8, time: 1700000000, message: 'hello' }));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(runtime.store.list('main').length, 1);
    assert.equal(runtime.store.list('other').length, 0);
    ws.close();
  } finally { await runtime.close(); }
});


test('shared reverse WebSocket route requires self_id and never guesses account', async () => {
  const port = 21000 + Math.floor(Math.random() * 1000);
  const second = { ...account, id: 'other', self_id: '20002' };
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account, second] });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, { headers: { authorization: 'Bearer transport-secret' } });
    await new Promise<void>(resolve => { ws.once('error', resolve); ws.once('close', resolve); ws.once('open', () => resolve()); });
    assert.notEqual(ws.readyState, WebSocket.OPEN);
  } finally { await runtime.close(); }
});

test('matching echo event is ingested, while action response resolves pending request', async () => {
  const port = 22000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const result = fetch(`http://127.0.0.1:${port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify({ account_id: 'main', client_request_id: 'echo-test', target_id: '42', message_type: 'private', message: 'send' }) });
    const [action] = await new Promise<[Record<string, unknown>, (packet: unknown) => void]>((resolve, reject) => {
      ws.once('message', raw => {
        const action = JSON.parse(raw.toString()) as Record<string, unknown>;
        const echo = action.echo;
        ws.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 10001, user_id: 42, message_id: 9, time: 1700000000, message: 'event', echo }));
        setTimeout(() => ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 10 }, echo })), 20);
        resolve([action, () => {}]);
      });
      setTimeout(() => reject(new Error('action was not sent')), 1000);
    });
    const response = await result;
    assert.equal(response.status, 200);
    assert.equal(runtime.store.list('main').length, 2);
    ws.close();
  } finally { await runtime.close(); }
});

test('send route uses service and rejects success response without message id', async () => {
  const port = 23000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const result = fetch(`http://127.0.0.1:${port}/api/messages/send`, { method: 'POST', headers: { authorization: 'Bearer api-secret', 'content-type': 'application/json' }, body: JSON.stringify({ account_id: 'main', client_request_id: 'missing-id', target_id: '42', message_type: 'private', message: 'send' }) });
    ws.once('message', raw => { const action = JSON.parse(raw.toString()) as Record<string, unknown>; ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: {}, echo: action.echo })); });
    const response = await result;
    assert.equal(response.status, 502);
    assert.equal(runtime.store.list('main').length, 0);
    ws.close();
  } finally { await runtime.close(); }
});
