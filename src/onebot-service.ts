import { normalizeEvent, type NormalizedMessage, type Segment } from './normalize.js';
import type { AccountConfig } from './config.js';
import type { PriorityConfig } from './priority.js';
import { applyPriority } from './priority.js';
import type { MessageStore } from './store.js';

export type PeerLike = { account: AccountConfig; socket: { readyState: number; send(data: string, callback?: (error?: Error) => void): void }; pending: Map<string, (value: unknown) => void> };
export interface ActionResult { status: 'ok' | 'failed' | 'timeout' | 'unsupported'; action: string; response?: unknown; error?: string; }
export interface OneBotGateway {
  sendMessage(account: AccountConfig, type: 'private' | 'group', target: string, message: string | Segment[], requestId: string): Promise<NormalizedMessage>;
  revokeMessage(account: AccountConfig, externalMessageId: string): Promise<ActionResult>;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function outgoing(account: AccountConfig, requestId: string, externalId: string, type: 'private' | 'group', target: string, content: string | Segment[]): NormalizedMessage {
  const segments = typeof content === 'string' ? [{ type: 'text', data: { text: content } }] : content;
  const text = segments.filter(s => s.type === 'text').map(s => String(s.data.text ?? '')).join('');
  const now = new Date().toISOString();
  return { id: `${account.id}:${requestId}`, account_id: account.id, provider_id: account.provider, transport_id: `outgoing:${account.id}`, direction: 'outgoing', external_message_id: externalId || null, client_request_id: requestId, event_fingerprint: '', conversation_id: `${account.id}:${type}:${target}`, conversation_type: type, group_id: type === 'group' ? target : null, peer_user_id: type === 'private' ? target : null, sender_id: account.self_id, sender_name: account.alias, sender_card: null, sent_at: now, received_at: now, plain_text: text, raw_message: content, segments, reply_to_message_id: null, at_users: segments.filter(s => s.type === 'at').map(s => String(s.data.qq ?? '')), at_me: false, at_all: false, priority: 'P2', priority_score: 35, requires_reply: false, urgent: false, deadline: null, raw_event: {} };
}
export class OneBotService implements OneBotGateway {
  constructor(private readonly peers: Map<string, PeerLike>, private readonly store: MessageStore, private readonly timeoutMs = 15000) {}
  async sendMessage(account: AccountConfig, type: 'private' | 'group', target: string, message: string | Segment[], requestId: string): Promise<NormalizedMessage> {
    const saved = this.store.list(account.id, 200).find(m => m.client_request_id === requestId);
    if (saved) return saved;
    const peer = this.peers.get(account.id);
    const action = type === 'private' ? 'send_private_msg' : 'send_group_msg';
    const params = type === 'private' ? { user_id: target, message } : { group_id: target, message };
    let response: unknown;
    if (peer?.socket.readyState === 1) response = await this.call(peer, action, params);
    else if (account.action_url) {
      const base = account.action_url;
      const url = base.endsWith('/') ? `${base}${action}` : `${base}/${action}`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (account.access_token) headers.authorization = `Bearer ${account.access_token}`;
      const httpResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params), signal: AbortSignal.timeout(this.timeoutMs) });
      if (!httpResponse.ok) throw Object.assign(new Error(`HTTP OneBot action returned ${httpResponse.status}`), { code: 'ACTION_FAILED' });
      response = await httpResponse.json();
      const result = record(response);
      if (result.status !== 'ok' || Number(result.retcode) !== 0) throw Object.assign(new Error('OneBot action rejected'), { code: 'ACTION_REJECTED' });
    } else throw Object.assign(new Error('No active Reverse WebSocket connection or HTTP action_url'), { code: 'TRANSPORT_UNAVAILABLE' });
    const result = record(response); const data = record(result.data);
    const row = outgoing(account, requestId, String(data.message_id ?? ''), type, target, message);
    if (!row.external_message_id) throw Object.assign(new Error('OneBot success response omitted data.message_id'), { code: 'ACTION_FAILED' });
    this.store.addOutgoing(row); return row;
  }
  async revokeMessage(account: AccountConfig, externalMessageId: string): Promise<ActionResult> {
    const own = this.store.list(account.id, 200).find(m => m.direction === 'outgoing' && m.external_message_id === externalMessageId);
    if (!own) return { status: 'unsupported', action: 'delete_msg', error: 'Target must be a known outgoing message; revoking others is not allowed.' };
    const peer = this.peers.get(account.id);
    if (!peer || peer.socket.readyState !== 1) return { status: 'timeout', action: 'delete_msg', error: 'No active Reverse WebSocket connection' };
    try { const response = await this.call(peer, 'delete_msg', { message_id: externalMessageId }); return { status: 'ok', action: 'delete_msg', response }; }
    catch (error) { return { status: 'failed', action: 'delete_msg', error: error instanceof Error ? error.message : 'Action failed' }; }
  }
  private call(peer: PeerLike, action: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const echo = crypto.randomUUID();
      const timer = setTimeout(() => { peer.pending.delete(echo); reject(Object.assign(new Error('OneBot action timed out'), { code: 'ACTION_TIMEOUT' })); }, this.timeoutMs);
      peer.pending.set(echo, value => { clearTimeout(timer); const response = record(value); if (response.status !== 'ok' || Number(response.retcode) !== 0) reject(Object.assign(new Error(String(response.message ?? 'OneBot action rejected')), { code: 'ACTION_REJECTED' })); else resolve(value); });
      peer.socket.send(JSON.stringify({ action, params, echo }), error => { if (error) { clearTimeout(timer); peer.pending.delete(echo); reject(error); } });
    });
  }
}
