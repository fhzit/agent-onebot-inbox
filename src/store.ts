import type { NormalizedMessage } from './normalize.js';

export interface InboxQuery {
  account_id?: string | undefined; type?: 'private' | 'group' | undefined; sender?: string | undefined; priority?: NormalizedMessage['priority'] | undefined; at_me?: boolean | undefined; keyword?: string | undefined; since?: string | undefined; until?: string | undefined; offset?: number | undefined; limit?: number | undefined; state?: 'unread'|'processed'|'dismissed'|undefined;
}
export interface InboxQueryResult { messages: NormalizedMessage[]; total: number; offset: number; limit: number; has_more: boolean; }

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
      (!filters.sender || m.sender_id === filters.sender || m.sender_name?.toLocaleLowerCase() === filters.sender.toLocaleLowerCase() || m.sender_card?.toLocaleLowerCase() === filters.sender.toLocaleLowerCase()) &&
      (!filters.priority || m.priority === filters.priority) &&
      (filters.at_me === undefined || m.at_me === filters.at_me) &&
      (filters.state === undefined || (filters.state === 'unread' ? (m.direction === 'incoming' && this.state(m.id)?.unread === true) : this.state(m.id)?.[filters.state] === true)) &&
      (!keyword || m.plain_text.toLocaleLowerCase().includes(keyword)) &&
      (!filters.since || m.sent_at >= filters.since) && (!filters.until || m.sent_at <= filters.until)
    ).sort((a, b) => b.sent_at.localeCompare(a.sent_at) || b.id.localeCompare(a.id));
    return { messages: matches.slice(offset, offset + limit), total: matches.length, offset, limit, has_more: offset + limit < matches.length };
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