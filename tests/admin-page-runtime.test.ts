import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { adminPage } from '../src/admin-page.js';

/**
 * Executes the served admin page's inline script against a stub DOM.
 *
 * Regression guard: the page appends transpiled TypeScript panel binders to one
 * inline script. A CommonJS `exports` shim in that appended code throws in the
 * browser and silently aborts every binder after it, which previously left the
 * conversation list stuck on its placeholder.
 */

class StubElement {
  tagName: string;
  id: string;
  children: StubElement[] = [];
  dataset: Record<string, string> = {};
  options: unknown[] = [];
  style = new Proxy({}, { get: () => () => {}, set: () => true });
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  elements = new Proxy({}, { get: () => ({ value: '', checked: false, disabled: false, readOnly: false }) });
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  textContent = '';
  scrollTop = 0;
  scrollHeight = 0;
  innerHTML = '';
  constructor(tag = 'div', id = '') { this.tagName = tag.toUpperCase(); this.id = id; }
  addEventListener() {}
  removeEventListener() {}
  append(...nodes: StubElement[]) { this.children.push(...nodes); }
  appendChild(node: StubElement) { this.children.push(node); return node; }
  prepend() {}
  insertBefore(node: StubElement) { this.children.unshift(node); return node; }
  insertAdjacentHTML() {}
  replaceChildren(...nodes: StubElement[]) { this.children = [...nodes]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  reset() {}
  setAttribute() {}
  removeAttribute() {}
  dispatchEvent() {}
  getAttribute() { return null; }
  matches() { return false; }
}

function runPage(): { sandbox: Record<string, unknown>; registry: Map<string, StubElement>; calls: string[] } {
  const ids = [...adminPage.matchAll(/id="([^"]+)"/g)].map(match => match[1]!);
  const registry = new Map(ids.map(id => [id, new StubElement('div', id)]));
  const calls: string[] = [];
  const document = {
    getElementById: (id: string) => registry.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag: string) => new StubElement(tag),
    addEventListener() {},
    body: new StubElement('body'),
    head: new StubElement('head'),
    documentElement: new StubElement('html'),
    hidden: false,
    cookie: '',
    title: 'admin',
    location: { origin: 'http://localhost', href: 'http://localhost/admin/' },
  };
  const fetchStub = async (input: string) => {
    calls.push(String(input));
    if (String(input).startsWith('/api/conversations?')) {
      return { ok: true, status: 200, json: async () => ({ conversations: [{ conversation_id: 'c1', account_id: 'acc', type: 'group', group_id: '555', peer_user_id: null, title: null, last_message: { id: 'm1', plain_text: '你好', sender_name: '小明', sent_at: new Date().toISOString(), priority: 'P2', direction: 'incoming' }, message_count: 1, unread_count: 1, last_at: new Date().toISOString() }], total: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({ messages: [], has_more: false }) };
  };
  const sandbox: Record<string, unknown> = {
    document,
    fetch: fetchStub,
    console,
    setTimeout: (fn: () => void) => { fn(); return 1; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    URLSearchParams,
    Event: class { constructor(public type: string) {} },
    FormData: class { get() { return ''; } },
    confirm: () => true,
    alert: () => {},
    CSS: { escape: (value: string) => value },
    location: document.location,
    navigator: { userAgent: 'node' },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const script = (adminPage.match(/<script>([\s\S]*?)<\/script>/) ?? [])[1]!;
  vm.runInContext(script, vm.createContext(sandbox), { filename: 'admin.js' });
  return { sandbox, registry, calls };
}

test('the served admin script boots without throwing and exposes the inbox binder', () => {
  assert.doesNotMatch(adminPage, /\bexports\./, 'appended binders must not carry a CommonJS exports shim');
  const { sandbox } = runPage();
  assert.equal(typeof sandbox.__chatRefresh, 'function', 'chat binder must be registered after the whole script runs');
});

test('the inbox binder renders a conversation row from the conversations API', async () => {
  const { sandbox, registry, calls } = runPage();
  (sandbox.__chatRefresh as () => void)();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.some(call => call.startsWith('/api/conversations?')), 'conversation list should be requested');
  const list = registry.get('chatList')!;
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0]!.dataset.conversation, 'c1');
});
