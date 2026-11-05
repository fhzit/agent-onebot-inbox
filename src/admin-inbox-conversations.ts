/**
 * Chat-style inbox: QQ-like conversation list + message thread.
 *
 * Renders with DOM APIs and textContent only — message bodies are untrusted
 * provider data, so nothing here is interpolated into innerHTML.
 */

export type InboxChatConversation = {
  conversation_id: string;
  account_id: string;
  type: 'private' | 'group';
  group_id: string | null;
  peer_user_id: string | null;
  title: string | null;
  last_message: { id: string; plain_text: string; sender_name: string | null; sent_at: string; priority: string; direction: string };
  message_count: number;
  unread_count: number;
  last_at: string;
};

export type InboxChatMessage = {
  id: string;
  account_id: string;
  conversation_id: string;
  direction: 'incoming' | 'outgoing';
  sender_id: string;
  sender_name: string | null;
  plain_text: string;
  sent_at: string;
  priority: string;
  at_me: boolean;
};

export type InboxChatOptions = {
  root: Document;
  get(path: string): Promise<unknown>;
  post?(path: string, body: unknown): Promise<unknown>;
  notify?(message: string, bad?: boolean): void;
};

const MAX_CONVERSATIONS = 100;
const THREAD_PAGE = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function clock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(value) === dayKey(today.toISOString())) return '今天';
  if (dayKey(value) === dayKey(yesterday.toISOString())) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function listStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(value) === dayKey(today.toISOString())) return clock(value);
  if (dayKey(value) === dayKey(yesterday.toISOString())) return '昨天';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function avatarHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  return hash;
}

function initials(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '?';
  const ascii = /^[\x20-\x7e]+$/.test(trimmed);
  return ascii ? trimmed.slice(0, 2).toUpperCase() : trimmed.slice(-2);
}

export function bindInboxChat(options: InboxChatOptions): { refresh(): void } {
  const { root } = options;
  const byId = (id: string): HTMLElement | null => root.getElementById(id);
  const list = byId('chatList');
  const thread = byId('chatMessages');
  const threadTitle = byId('chatThreadTitle');
  const threadMeta = byId('chatThreadMeta');
  const loadOlder = byId('chatLoadOlder') as HTMLButtonElement | null;
  const summaryLabel = byId('chatSummary');
  const search = byId('chatSearch') as HTMLInputElement | null;
  const accountSelect = byId('chatAccount') as HTMLSelectElement | null;
  const refreshButton = byId('chatRefresh') as HTMLButtonElement | null;
  const typeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-chat-type]')];

  if (!list || !thread) return { refresh: () => {} };

  const listEl: HTMLElement = list;
  const threadEl: HTMLElement = thread;

  let conversations: InboxChatConversation[] = [];
  let messages: InboxChatMessage[] = [];
  let selected: string | null = null;
  let hasMore = false;
  let loading = false;
  let type = '';
  let query = '';

  const notify = (message: string, bad = false) => options.notify?.(message, bad);

  const clear = (node: HTMLElement, message?: string): void => {
    node.replaceChildren();
    if (!message) return;
    const empty = root.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = message;
    node.append(empty);
  };

  const accountAlias = (id: string): string => {
    if (!accountSelect) return id;
    const match = [...accountSelect.options].find(option => option.value === id);
    return match && match.value ? match.textContent ?? id : id;
  };

  const conversationTitle = (item: InboxChatConversation): string =>
    text(item.title, item.type === 'group' ? `群 ${item.group_id ?? item.conversation_id}` : `私聊 ${item.peer_user_id ?? item.conversation_id}`);

  function renderList(): void {
    const needle = query.trim().toLowerCase();
    const visible = conversations.filter(item => {
      if (!needle) return true;
      return `${conversationTitle(item)} ${item.last_message.plain_text} ${item.last_message.sender_name ?? ''}`.toLowerCase().includes(needle);
    });
    clear(listEl);
    if (!visible.length) {
      listEl.append(Object.assign(root.createElement('div'), { className: 'chat-empty', textContent: needle ? '没有匹配的会话' : '还没有会话，收到消息后会出现在这里' }));
      if (summaryLabel) summaryLabel.textContent = '0 个会话';
      return;
    }
    for (const item of visible) {
      const row = root.createElement('button');
      row.type = 'button';
      row.className = `chat-row${item.conversation_id === selected ? ' active' : ''}`;
      row.dataset.conversation = item.conversation_id;
      row.setAttribute('aria-current', item.conversation_id === selected ? 'true' : 'false');

      const avatar = root.createElement('span');
      avatar.className = 'chat-avatar';
      avatar.style.setProperty('--hue', String(avatarHue(item.conversation_id)));
      avatar.textContent = initials(conversationTitle(item));

      const body = root.createElement('span');
      body.className = 'chat-row-body';
      const top = root.createElement('span');
      top.className = 'chat-row-top';
      const name = root.createElement('span');
      name.className = 'chat-row-name';
      name.textContent = conversationTitle(item);
      const time = root.createElement('span');
      time.className = 'chat-row-time';
      time.textContent = listStamp(item.last_at);
      top.append(name, time);

      const bottom = root.createElement('span');
      bottom.className = 'chat-row-bottom';
      const preview = root.createElement('span');
      preview.className = 'chat-row-preview';
      const who = item.last_message.direction === 'outgoing' ? '我: ' : (item.type === 'group' && item.last_message.sender_name ? `${item.last_message.sender_name}: ` : '');
      preview.textContent = `${who}${item.last_message.plain_text.replace(/\s+/g, ' ').slice(0, 80) || '[非文本消息]'}`;
      bottom.append(preview);

      if (item.unread_count > 0) {
        const badge = root.createElement('span');
        badge.className = 'chat-unread';
        badge.textContent = item.unread_count > 99 ? '99+' : String(item.unread_count);
        bottom.append(badge);
      }
      if (item.type === 'group') {
        const tag = root.createElement('span');
        tag.className = 'chat-tag';
        tag.textContent = '群';
        top.insertBefore(tag, name);
      }

      body.append(top, bottom);
      row.append(avatar, body);
      listEl.append(row);
    }
    if (summaryLabel) summaryLabel.textContent = `${visible.length} 个会话 · ${visible.reduce((total, item) => total + item.unread_count, 0)} 条未读`;
  }

  function renderThread(reset: boolean): void {
    if (reset) threadEl.replaceChildren();
    if (!selected) {
      clear(threadEl, '左侧选择群聊或私聊，查看完整对话');
      if (threadTitle) threadTitle.textContent = '选择一个会话';
      if (threadMeta) threadMeta.textContent = '';
      if (loadOlder) loadOlder.hidden = true;
      return;
    }
    const conversation = conversations.find(item => item.conversation_id === selected);
    if (threadTitle) threadTitle.textContent = conversation ? conversationTitle(conversation) : '会话';
    if (threadMeta) {
      threadMeta.textContent = conversation
        ? `${conversation.type === 'group' ? `群聊 ${conversation.group_id ?? ''}` : `私聊 ${conversation.peer_user_id ?? ''}`} · ${accountAlias(conversation.account_id)} · ${conversation.message_count} 条消息`
        : '';
    }
    if (!messages.length) {
      clear(threadEl, '这个会话还没有消息');
      if (loadOlder) loadOlder.hidden = true;
      return;
    }
    let lastDay = '';
    let lastSender = '';
    for (const message of messages) {
      const key = dayKey(message.sent_at);
      if (key !== lastDay) {
        const divider = root.createElement('div');
        divider.className = 'chat-day';
        divider.textContent = dayLabel(message.sent_at);
        threadEl.append(divider);
        lastDay = key;
        lastSender = '';
      }
      const outgoing = message.direction === 'outgoing';
      const sender = outgoing ? '我' : (message.sender_name || message.sender_id);
      const showSender = !outgoing && sender !== lastSender;
      lastSender = sender;

      const group = root.createElement('div');
      group.className = `chat-msg ${outgoing ? 'out' : 'in'}${message.priority === 'P0' || message.priority === 'P1' ? ' hot' : ''}`;
      if (showSender) {
        const who = root.createElement('div');
        who.className = 'chat-sender';
        who.textContent = sender;
        group.append(who);
      }
      const bubble = root.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = message.plain_text || '[非文本消息]';
      const meta = root.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = clock(message.sent_at);
      if (message.at_me) {
        const at = root.createElement('span');
        at.className = 'chat-at';
        at.textContent = '@我';
        meta.append(at);
      }
      if (!outgoing && options.post) {
        const actions = root.createElement('span');
        actions.className = 'chat-actions';
        const done = root.createElement('button');
        done.type = 'button';
        done.textContent = '处理';
        done.dataset.chatAction = 'mark_processed';
        done.dataset.chatId = message.id;
        const drop = root.createElement('button');
        drop.type = 'button';
        drop.className = 'warn';
        drop.textContent = '忽略';
        drop.dataset.chatAction = 'dismiss';
        drop.dataset.chatId = message.id;
        actions.append(done, drop);
        meta.append(actions);
      }
      group.append(bubble, meta);
      threadEl.append(group);
    }
    if (loadOlder) loadOlder.hidden = !hasMore;
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  async function loadThread(conversationId: string): Promise<void> {
    if (loading) return;
    loading = true;
    selected = conversationId;
    messages = [];
    hasMore = false;
    renderList();
    renderThread(true);
    clear(threadEl, '加载对话中…');
    try {
      const payload = asRecord(await options.get(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=${THREAD_PAGE}`));
      const rows = Array.isArray(payload.messages) ? payload.messages : [];
      messages = rows as InboxChatMessage[];
      hasMore = payload.has_more === true;
      renderThread(true);
    } catch (error) {
      clear(threadEl, '对话加载失败，请重试');
      notify(error instanceof Error ? error.message : '对话加载失败', true);
    } finally {
      loading = false;
    }
  }

  async function loadOlderMessages(): Promise<void> {
    if (!selected || !messages.length || loading) return;
    loading = true;
    const anchor = messages[0]!.sent_at;
    try {
      const payload = asRecord(await options.get(`/api/conversations/${encodeURIComponent(selected)}/messages?limit=${THREAD_PAGE}&before=${encodeURIComponent(anchor)}`));
      const rows = Array.isArray(payload.messages) ? payload.messages as InboxChatMessage[] : [];
      hasMore = payload.has_more === true;
      const previousHeight = threadEl.scrollHeight;
      messages = [...rows, ...messages];
      renderThread(true);
      threadEl.scrollTop = threadEl.scrollHeight - previousHeight;
    } catch (error) {
      notify(error instanceof Error ? error.message : '加载更早消息失败', true);
    } finally {
      loading = false;
    }
  }

  async function refresh(): Promise<void> {
    const filter = root.getElementById('accountFilter') as HTMLSelectElement | null;
    if (filter && accountSelect && accountSelect.options.length <= 1 && filter.options.length > 1) {
      accountSelect.replaceChildren(...[...filter.options].map(option => option.cloneNode(true) as HTMLOptionElement));
    }
    const accountId = accountSelect?.value ?? '';
    const params = new URLSearchParams({ limit: String(MAX_CONVERSATIONS) });
    if (type) params.set('type', type);
    if (accountId) params.set('account_id', accountId);
    try {
      const payload = asRecord(await options.get(`/api/conversations?${params.toString()}`));
      conversations = Array.isArray(payload.conversations) ? payload.conversations as InboxChatConversation[] : [];
      if (selected && !conversations.some(item => item.conversation_id === selected)) selected = null;
      renderList();
      renderThread(true);
      if (conversations.length && !selected) {
        // Keep the empty right pane until the operator picks a conversation.
        clear(threadEl, '左侧选择群聊或私聊，查看完整对话');
        if (loadOlder) loadOlder.hidden = true;
      }
    } catch (error) {
      clear(listEl, '会话列表加载失败，请重试');
      notify(error instanceof Error ? error.message : '会话加载失败', true);
    }
  }

  async function act(action: string, messageId: string): Promise<void> {
    if (!options.post) return;
    try {
      await options.post(`/api/messages/${action}`, { message_id: messageId });
      notify(action === 'dismiss' ? '已忽略；不会标记 QQ 已读' : '已标记处理；不会标记 QQ 已读');
      await loadThread(selected!);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作失败', true);
    }
  }

  listEl.addEventListener('click', event => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-conversation]');
    if (row?.dataset.conversation) void loadThread(row.dataset.conversation);
  });

  threadEl.addEventListener('click', event => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-chat-action]');
    if (button?.dataset.chatAction && button.dataset.chatId) void act(button.dataset.chatAction, button.dataset.chatId);
  });

  search?.addEventListener('input', () => { query = search.value; renderList(); });
  accountSelect?.addEventListener('change', () => { selected = null; void refresh(); });
  refreshButton?.addEventListener('click', () => void refresh());
  loadOlder?.addEventListener('click', () => void loadOlderMessages());
  for (const button of typeButtons) {
    button.addEventListener('click', () => {
      type = button.dataset.chatType ?? '';
      for (const other of typeButtons) other.classList.toggle('active', other === button);
      selected = null;
      void refresh();
    });
  }

  return { refresh: () => void refresh() };
}
