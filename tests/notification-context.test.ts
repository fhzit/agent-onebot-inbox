import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNotificationContext, dispatchNotification } from '../src/server.js';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';
import { MemoryNotificationConfigStore, defaultNotificationSettings } from '../src/notification-settings.js';

function message(sequence: number, text: string, userId = '2002') {
  const normalized = normalizeEvent('acc', 'napcat', 'fixture', {
    post_type: 'message',
    message_type: 'private',
    self_id: '1001',
    user_id: userId,
    message_id: sequence,
    time: 1_700_000_000 + sequence,
    message: text,
    sender: { nickname: '阿三' },
  });
  assert.ok(normalized);
  return normalized;
}

function seededStore(): { store: MessageStore; ids: string[] } {
  const store = new MessageStore();
  const ids: string[] = [];
  for (const [index, text] of ['第一句', '第二句', '叫我的那句', '后续一句'].entries()) {
    const inserted = store.insert(message(index + 1, text));
    ids.push(inserted.message.id);
  }
  return { store, ids };
}

test('context renders a bounded transcript and marks the anchor message', async () => {
  const { store, ids } = seededStore();
  const anchor = store.get(ids[2]!)!;
  const context = await buildNotificationContext(store, anchor);
  assert.match(context, /▸ /);
  assert.match(context, /叫我的那句/);
  assert.match(context, /第一句/);
  assert.match(context, /后续一句/);
  assert.match(context, /阿三/);
});

test('context is empty when no history source is available', async () => {
  const { store, ids } = seededStore();
  assert.equal(await buildNotificationContext(undefined, store.get(ids[2]!)!), '');
});

test('context never throws when the history query fails', async () => {
  const { store, ids } = seededStore();
  const broken = { context: () => { throw new Error('store offline'); } };
  assert.equal(await buildNotificationContext(broken, store.get(ids[2]!)!), '');
});

test('context output stays within the delivery budget', async () => {
  const store = new MessageStore();
  for (let index = 0; index < 40; index += 1) {
    store.insert(message(index + 1, '很长的内容'.repeat(120)));
  }
  const anchorId = store.query({ limit: 1 }).messages[0]!.id;
  const context = await buildNotificationContext(store, store.get(anchorId)!);
  assert.ok(context.length <= 1200, `context length ${context.length} exceeded budget`);
});

async function captureDispatch(includeContext: boolean): Promise<Record<string, unknown>> {
  const { store, ids } = seededStore();
  const anchor = store.get(ids[2]!)!;
  const settingsStore = new MemoryNotificationConfigStore();
  await settingsStore.put({
    ...defaultNotificationSettings,
    enabled: true,
    webhookUrl: 'https://example.invalid/hook',
    webhookSecret: 'secret',
    minPriority: 'P4',
    includePreview: true,
    includeContext,
  });
  let captured: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body)) as Record<string, unknown>;
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
  try {
    const delivered = await dispatchNotification(settingsStore, anchor, { id: 'acc', alias: '主号', self_id: '1001', provider: 'napcat', enabled: true, permission: 'readonly', access_token: 'x' }, undefined, store);
    assert.equal(delivered, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured;
}

test('disabled context setting keeps the webhook payload compact', async () => {
  const payload = await captureDispatch(false);
  assert.equal(payload.event, 'message.received');
  assert.equal('context' in payload, false);
});

test('enabled context setting ships the surrounding dialogue', async () => {
  const payload = await captureDispatch(true);
  assert.equal(payload.event, 'message.received');
  assert.equal(typeof payload.context, 'string');
  assert.match(String(payload.context), /第一句/);
  assert.match(String(payload.context), /▸ /);
});
