import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindInboxChat } from '../src/admin-inbox-conversations.js';

class FakeElement {
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  hidden = false;
  type = '';
  scrollTop = 0;
  scrollHeight = 0;
  style = { setProperty: () => {} };
  listeners: Record<string, (event: unknown) => void> = {};
  attributes: Record<string, string> = {};
  constructor(public tag: string) {}
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeElement[]) { this.children = [...nodes]; }
  insertBefore(node: FakeElement) { this.children.unshift(node); return node; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, handler: (event: unknown) => void) { this.listeners[name] = handler; }
  closest(selector: string): FakeElement | null {
    if (selector === '[data-conversation]') return this.dataset.conversation ? this : null;
    if (selector === '[data-chat-action]') return this.dataset.chatAction ? this : null;
    return null;
  }
  get text(): string {
    return this.textContent + this.children.map(child => child.text).join('');
  }
}

function documentStub(): { doc: Document; nodes: Map<string, FakeElement> } {
  const nodes = new Map<string, FakeElement>();
  for (const id of ['chatList', 'chatMessages', 'chatThreadTitle', 'chatThreadMeta', 'chatLoadOlder', 'chatSummary', 'chatSearch', 'chatAccount', 'chatRefresh', 'accountFilter']) {
    const node = new FakeElement('div');
    if (id === 'chatAccount' || id === 'accountFilter') (node as unknown as { options: unknown[] }).options = [];
    nodes.set(id, node);
  }
  const doc = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
    querySelectorAll: () => [],
  } as unknown as Document;
  return { doc, nodes };
}

const conversation = (overrides: Record<string, unknown>) => ({
  conversation_id: 'conv-1',
  account_id: 'acc',
  type: 'group',
  group_id: '555',
  peer_user_id: null,
  title: null,
  last_message: { id: 'm3', plain_text: '最新一条', sender_name: '小明', sent_at: new Date().toISOString(), priority: 'P2', direction: 'incoming' },
  message_count: 3,
  unread_count: 2,
  last_at: new Date().toISOString(),
  ...overrides,
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('conversation list shows one row per chat with preview and unread badge', async () => {
  const { doc, nodes } = documentStub();
  const chat = bindInboxChat({
    root: doc,
    get: async path => {
      if (path.startsWith('/api/conversations?')) {
        return {
          conversations: [
            conversation({}),
            conversation({ conversation_id: 'conv-2', type: 'private', group_id: null, peer_user_id: '3003', title: '私聊对象', unread_count: 0, last_message: { id: 'm9', plain_text: '你好', sender_name: '私聊对象', sent_at: new Date().toISOString(), priority: 'P2', direction: 'incoming' } }),
          ],
          total: 2,
        };
      }
      return { messages: [], has_more: false };
    },
  });
  chat.refresh();
  await flush();
  await flush();
  const list = nodes.get('chatList')!;
  assert.equal(list.children.length, 2, 'one row per conversation');
  const first = list.children[0]!;
  assert.match(first.text, /群 555/);
  assert.match(first.text, /小明: 最新一条/);
  const badge = first.children[1]!.children[1]!.children.find(child => child.className === 'chat-unread');
  assert.equal(badge?.textContent, '2');
  assert.match(nodes.get('chatSummary')!.textContent, /2 个会话/);
});

test('opening a conversation renders the thread with day divider and direction classes', async () => {
  const { doc, nodes } = documentStub();
  const stamp = new Date().toISOString();
  const chat = bindInboxChat({
    root: doc,
    get: async path => {
      if (path.startsWith('/api/conversations?')) return { conversations: [conversation({})], total: 1 };
      return {
        messages: [
          { id: 'm1', account_id: 'acc', conversation_id: 'conv-1', direction: 'incoming', sender_id: '2002', sender_name: '小明', plain_text: '大家好', sent_at: stamp, priority: 'P2', at_me: false },
          { id: 'm2', account_id: 'acc', conversation_id: 'conv-1', direction: 'outgoing', sender_id: '1001', sender_name: '我', plain_text: '收到', sent_at: stamp, priority: 'P2', at_me: false },
        ],
        has_more: false,
      };
    },
    post: async () => ({}),
  });
  chat.refresh();
  await flush();
  await flush();
  const list = nodes.get('chatList')!;
  const row = list.children[0]!;
  list.listeners.click?.({ target: { closest: (selector: string) => row.closest(selector) } });
  await flush();
  await flush();
  const thread = nodes.get('chatMessages')!;
  assert.ok(thread.children.some(child => child.className === 'chat-day'), 'day divider rendered');
  const bubbles = thread.children.filter(child => child.className.startsWith('chat-msg'));
  assert.equal(bubbles.length, 2);
  assert.ok(bubbles[0]!.className.includes('in'));
  assert.ok(bubbles[1]!.className.includes('out'));
  assert.match(nodes.get('chatThreadTitle')!.textContent, /群 555/);
  assert.match(nodes.get('chatThreadMeta')!.textContent, /3 条消息/);
});
