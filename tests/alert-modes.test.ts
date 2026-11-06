import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchNotification } from '../src/server.js';
import { MemoryNotificationConfigStore, defaultNotificationSettings } from '../src/notification-settings.js';
import { normalizeEvent } from '../src/normalize.js';

const account = { id: 'acc', alias: '主号', self_id: '1001', provider: 'napcat', enabled: true, permission: 'readonly', access_token: 'x' } as never;

function messageAt(priority: 'P0' | 'P1' | 'P2', atMe = false) {
  const event: Record<string, unknown> = {
    post_type: 'message', message_type: 'group', self_id: '1001', group_id: '77', user_id: '2002',
    message_id: Math.floor(Math.random() * 1e6), time: 1700000000, message: atMe ? '[CQ:at,qq=1001] 紧急' : '普通消息',
  };
  const normalized = normalizeEvent('acc', 'napcat', 'ws', event as never)!;
  return { ...normalized, priority } as typeof normalized;
}

async function delivers(modes: Record<string, string>, priority: 'P0' | 'P1' | 'P2'): Promise<boolean> {
  const store = new MemoryNotificationConfigStore();
  await store.put({
    ...defaultNotificationSettings,
    enabled: true,
    webhookUrl: 'https://notify.example.test/hook',
    webhookSecret: 'secret',
    modes: modes as never,
  });
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
  try {
    await dispatchNotification(store, messageAt(priority), account);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return called > 0;
}

test('each level follows its own switch: push sends, off and digest stay quiet', async () => {
  const modes = { P0: 'push', P1: 'off', P2: 'digest', P3: 'off', P4: 'off' };
  assert.equal(await delivers(modes, 'P0'), true, 'P0 push should send');
  assert.equal(await delivers(modes, 'P1'), false, 'P1 off should not send');
  assert.equal(await delivers(modes, 'P2'), false, 'P2 digest is left to the summary, not pushed');
});

test('all levels off means nothing is ever pushed', async () => {
  const modes = { P0: 'off', P1: 'off', P2: 'off', P3: 'off', P4: 'off' };
  for (const level of ['P0', 'P1', 'P2'] as const) {
    assert.equal(await delivers(modes, level), false, `${level} must stay silent`);
  }
});

test('push on P1 and P2 sends those levels without touching P0', async () => {
  const modes = { P0: 'off', P1: 'push', P2: 'push', P3: 'off', P4: 'off' };
  assert.equal(await delivers(modes, 'P0'), false);
  assert.equal(await delivers(modes, 'P1'), true);
  assert.equal(await delivers(modes, 'P2'), true);
});
