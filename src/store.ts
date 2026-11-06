import type { NormalizedMessage } from './normalize.js';

export interface InboxQuery {
  account_id?: string | undefined; type?: 'private' | 'group' | undefined; direction?: 'incoming' | 'outgoing' | undefined; sender?: string | undefined; priority?: NormalizedMessage['priority'] | undefined; at_me?: boolean | undefined; keyword?: string | undefined; since?: string | undefined; until?: string | undefined; offset?: number | undefined; limit?: number | undefined; state?: 'unread'|'processed'|'dismissed'|undefined;
}
export interface InboxQueryResult { messages: NormalizedMessage[]; total: number; offset: number; limit: number; has_more: boolean; }

export type ConversationQuery = {
  account_id?: string | undefined;
  type?: 'private' | 'group' | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
};

export type ConversationSummary = {
  conversation_id: string;
  account_id: string;
  type: 'private' | 'group';
  group_id: string | null;
  peer_user_id: string | null;
  /** Human-readable conversation name when the provider or contact sync supplied one. */
  title: string | null;
  last_message: {
    id: string;
    plain_text: string;
    sender_id: string;
    sender_name: string | null;
    sent_at: string;
    priority: NormalizedMessage['priority'];
    direction: NormalizedMessage['direction'];
  };
  message_count: number;
  unread_count: number;
  last_at: string;
};

export type ConversationQueryResult = {
  conversations: ConversationSummary[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
};

export type ConversationMessageQuery = {
  account_id?: string | undefined;
  limit?: number | undefined;
  /** ISO timestamp cursor: return messages strictly older than this instant. */
  before?: string | undefined;
};

export type ConversationMessageResult = {
  conversation_id: string;
  messages: NormalizedMessage[];
  has_more: boolean;
};

export interface InboxState {
  unread: boolean;
  seen_by_agent: boolean;
  processed: boolean;
  dismissed: boolean;
  /** Always false: agent inbox operations never invoke a QQ read action. */
  qq_read: false;
}

export class MessageStore {
  readonly #byId = new Map<string, NormalizedMessage>();
  readonly #requestIds = new Map<string, NormalizedMessage>();
  readonly #fingerprints = new Map<string, NormalizedMessage>();
  readonly #states = new Map<string, Omit<InboxState, 'unread' | 'qq_read'>>();
  insert(message: NormalizedMessage): { inserted: boolean; message: NormalizedMessage } {
    const fingerprintKey = `${message.account_id}:${message.event_fingerprint}`;
    const fingerprintMatch = message.direction === 'incoming' ? this.#fingerprints.get(fingerprintKey) : undefined;
    if (fingerprintMatch) return { inserted: false, message: fingerprintMatch };
    if (this.#byId.has(message.id)) return { inserted: false, message: this.#byId.get(message.id)! };
    this.#byId.set(message.id, message);
    if (message.direction === 'incoming') this.#fingerprints.set(fingerprintKey, message);
    return { inserted: true, message };
  }
  addOutgoing(message: NormalizedMessage): { inserted: boolean; message: NormalizedMessage } {
    const key = `${message.account_id}:${message.client_request_id}`;
    const old = this.#requestIds.get(key);
    if (old) return { inserted: false, message: old };
    const inserted = this.insert(message);
    if (inserted.inserted && message.client_request_id) this.#requestIds.set(key, message);
    return inserted;
  }
  get(id: string): NormalizedMessage | undefined { return this.#byId.get(id); }
  state(id: string): InboxState | undefined {
    const message = this.#byId.get(id);
    if (!message) return undefined;
    const saved = this.#states.get(id);
    const incoming = message.direction === 'incoming';
    return { unread: incoming && !saved?.seen_by_agent, seen_by_agent: saved?.seen_by_agent ?? false, processed: saved?.processed ?? false, dismissed: saved?.dismissed ?? false, qq_read: false };
  }
  markSeen(id: string): InboxState | undefined { return this.updateState(id, { seen_by_agent: true }); }
  markAllSeen(): number { let updated=0; for (const message of this.#byId.values()) if(message.direction==='incoming'&&this.state(message.id)?.unread){this.updateState(message.id,{seen_by_agent:true});updated++;} return updated; }
  markProcessed(id: string): InboxState | undefined { return this.updateState(id, { seen_by_agent: true, processed: true }); }
  dismiss(id: string): InboxState | undefined { return this.updateState(id, { seen_by_agent: true, dismissed: true }); }
  private updateState(id: string, update: Partial<Omit<InboxState, 'unread' | 'qq_read'>>): InboxState | undefined {
    if (!this.#byId.has(id)) return undefined;
    const previous: Omit<InboxState, 'unread' | 'qq_read'> = this.#states.get(id) ?? { seen_by_agent: false, processed: false, dismissed: false };
    this.#states.set(id, { ...previous, ...update });
    return this.state(id);
  }
  context(messageId: string, before = 20, after = 10): NormalizedMessage[] {
    const target = this.#byId.get(messageId);
    if (!target) return [];
    const messages = [...this.#byId.values()].filter(m => m.account_id === target.account_id && m.conversation_id === target.conversation_id)
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
    const index = messages.findIndex(m => m.id === messageId);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) throw new Error('Context window must use finite nonnegative bounds');
    const left = Math.min(100, Math.trunc(before));
    const right = Math.min(100, Math.trunc(after));
    return messages.slice(Math.max(0, index - left), index + right + 1);
  }
  query(filters: InboxQuery = {}): InboxQueryResult {
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const limit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 50)));
    const keyword = filters.keyword?.trim().toLocaleLowerCase();
    const matches = [...this.#byId.values()].filter(m =>
      (!filters.account_id || m.account_id === filters.account_id) &&
      (!filters.type || m.conversation_type === filters.type) &&
      (!filters.direction || m.direction === filters.direction) &&
      (!filters.sender || m.sender_id === filters.sender || m.sender_name?.toLocaleLowerCase() === filters.sender.toLocaleLowerCase() || m.sender_card?.toLocaleLowerCase() === filters.sender.toLocaleLowerCase()) &&
      (!filters.priority || m.priority === filters.priority) &&
      (filters.at_me === undefined || m.at_me === filters.at_me) &&
      (filters.state === undefined || (filters.state === 'unread' ? (m.direction === 'incoming' && this.state(m.id)?.unread === true) : this.state(m.id)?.[filters.state] === true)) &&
      (!keyword || m.plain_text.toLocaleLowerCase().includes(keyword)) &&
      (!filters.since || m.sent_at >= filters.since) && (!filters.until || m.sent_at <= filters.until)
    ).sort((a, b) => b.sent_at.localeCompare(a.sent_at) || b.id.localeCompare(a.id));
    return { messages: matches.slice(offset, offset + limit), total: matches.length, offset, limit, has_more: offset + limit < matches.length };
  }
  /** Conversation-level rollups for a chat-style inbox: one row per group or private chat. */
  conversations(filters: ConversationQuery = {}): ConversationQueryResult {
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const limit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 50)));
    const grouped = new Map<string, NormalizedMessage[]>();
    for (const message of this.#byId.values()) {
      if (filters.account_id && message.account_id !== filters.account_id) continue;
      if (filters.type && message.conversation_type !== filters.type) continue;
      const key = `${message.account_id}\u0000${message.conversation_id}`;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(message);
      else grouped.set(key, [message]);
    }
    const rows: ConversationSummary[] = [];
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
      const last = bucket[bucket.length - 1]!;
      const peer = [...bucket].reverse().find(message => message.direction === 'incoming' && message.sender_name);
      rows.push({
        conversation_id: last.conversation_id,
        account_id: last.account_id,
        type: last.conversation_type,
        group_id: last.group_id,
        peer_user_id: last.peer_user_id,
        title: last.conversation_type === 'private' ? (peer?.sender_name ?? null) : null,
        last_message: {
          id: last.id,
          plain_text: last.plain_text,
          sender_id: last.sender_id,
          sender_name: last.sender_name,
          sent_at: last.sent_at,
          priority: last.priority,
          direction: last.direction,
        },
        message_count: bucket.length,
        unread_count: bucket.filter(message => message.direction === 'incoming' && this.state(message.id)?.unread === true).length,
        last_at: last.sent_at,
      });
    }
    rows.sort((a, b) => b.last_at.localeCompare(a.last_at) || b.conversation_id.localeCompare(a.conversation_id));
    return { conversations: rows.slice(offset, offset + limit), total: rows.length, offset, limit, has_more: offset + limit < rows.length };
  }

  /** Chronological thread for one conversation, paged backwards from `before`. */
  conversationMessages(conversationId: string, filters: ConversationMessageQuery = {}): ConversationMessageResult {
    const limit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 50)));
    const all = [...this.#byId.values()]
      .filter(message => message.conversation_id === conversationId && (!filters.account_id || message.account_id === filters.account_id))
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
    const eligible = filters.before ? all.filter(message => message.sent_at < filters.before!) : all;
    const window = eligible.slice(Math.max(0, eligible.length - limit));
    return { conversation_id: conversationId, messages: window, has_more: eligible.length > window.length };
  }
  list(accountId?: string, limit = 50): NormalizedMessage[] {
    return [...this.#byId.values()].filter(m => !accountId || m.account_id === accountId)
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at)).slice(0, Math.max(1, Math.min(limit, 200)));
  }
  summary(accountId?: string, since?: string): { count: number; unread: number; high_priority: number; by_account: Record<string, number>; messages: NormalizedMessage[] } {
    const messages = [...this.#byId.values()].filter(m => (!accountId || m.account_id === accountId) && (!since || m.sent_at >= since));
    const by_account: Record<string, number> = {};
    for (const message of messages) by_account[message.account_id] = (by_account[message.account_id] ?? 0) + 1;
    return { count: messages.length, unread: messages.filter(m=>m.direction==='incoming'&&this.state(m.id)?.unread).length, high_priority: messages.filter(m=>m.priority==='P0'||m.priority==='P1').length, by_account, messages: messages.sort((a,b)=>b.sent_at.localeCompare(a.sent_at)).slice(0,50) };
  }
}