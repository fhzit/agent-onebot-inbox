import { createHash, timingSafeEqual } from 'node:crypto';

export type Segment = { type: string; data: Record<string, unknown> };
export type OneBotEvent = {
  time?: number;
  self_id?: number | string;
  post_type?: string;
  message_type?: 'private' | 'group';
  sub_type?: string;
  message_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  message?: string | Segment[];
  raw_message?: string;
  sender?: { nickname?: string; card?: string; user_id?: number | string };
  [key: string]: unknown;
};
export type NormalizedMessage = {
  id: string;
  account_id: string;
  provider_id: string;
  transport_id: string;
  direction: 'incoming' | 'outgoing';
  external_message_id: string | null;
  client_request_id: string | null;
  event_fingerprint: string;
  conversation_id: string;
  conversation_type: 'private' | 'group';
  group_id: string | null;
  peer_user_id: string | null;
  sender_id: string;
  sender_name: string | null;
  sender_card: string | null;
  sent_at: string;
  received_at: string;
  plain_text: string;
  raw_message: unknown;
  segments: Segment[];
  reply_to_message_id: string | null;
  at_users: string[];
  at_me: boolean;
  at_all: boolean;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  priority_score: number;
  requires_reply: boolean;
  urgent: boolean;
  deadline: string | null;
  raw_event: OneBotEvent;
};

export function normalizeSegments(input: OneBotEvent['message']): Segment[] {
  if (Array.isArray(input)) return input.map(s => ({ type: String(s.type), data: s.data ?? {} }));
  if (typeof input === 'string') {
    const parts: Segment[] = [];
    const pattern = /\[CQ:([a-zA-Z0-9_-]+)(?:,([^\]]*))?\]/g;
    let last = 0;
    for (const match of input.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > last) parts.push({ type: 'text', data: { text: input.slice(last, index) } });
      const data: Record<string, unknown> = {};
      for (const pair of (match[2] ?? '').split(',')) {
        const eq = pair.indexOf('=');
        if (eq > 0) data[pair.slice(0, eq)] = pair.slice(eq + 1).replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&amp;/g, '&');
      }
      parts.push({ type: match[1] ?? 'unknown', data });
      last = index + match[0].length;
    }
    if (last < input.length || parts.length === 0) parts.push({ type: 'text', data: { text: input.slice(last) } });
    return parts;
  }
  return [];
}

export function priorityFor(score: number): NormalizedMessage['priority'] {
  if (score >= 80) return 'P0';
  if (score >= 60) return 'P1';
  if (score >= 35) return 'P2';
  if (score >= 15) return 'P3';
  return 'P4';
}

export function normalizeEvent(accountId: string, provider: string, transportId: string, event: OneBotEvent): NormalizedMessage | null {
  if (event.post_type !== 'message' || !event.message_type) return null;
  const selfId = String(event.self_id ?? '');
  const senderId = String(event.user_id ?? event.sender?.user_id ?? '');
  const groupId = event.message_type === 'group' ? String(event.group_id ?? '') : null;
  const segments = normalizeSegments(event.message);
  const text = segments.filter(s => s.type === 'text').map(s => String(s.data.text ?? '')).join('');
  const atUsers = segments.filter(s => s.type === 'at').map(s => String(s.data.qq ?? '')).filter(Boolean);
  const atAll = atUsers.includes('all');
  const atMe = !atAll && atUsers.includes(selfId);
  let score = event.message_type === 'private' ? 15 : 0;
  if (atMe) score += 25;
  const id = String(event.message_id ?? '');
  const sentAt = new Date((event.time ?? Date.now() / 1000) * 1000).toISOString();
  // Message IDs are the strongest transport-independent event identity. A missing
  // timestamp otherwise falls back to Date.now(), making HTTP/WS retries diverge.
  const stableTime = event.time === undefined ? null : event.time;
  const fingerprint = createHash('sha256').update(JSON.stringify(id
    ? [accountId, event.message_type, groupId ?? senderId, senderId, id]
    : [accountId, event.message_type, groupId ?? senderId, senderId, stableTime, segments])).digest('hex');
  const scoreBounded = Math.max(0, Math.min(score, 100));
  return {
    id: createHash('sha256').update(`${accountId}:${id || fingerprint}`).digest('hex'),
    account_id: accountId, provider_id: provider, transport_id: transportId,
    direction: 'incoming', external_message_id: id || null, client_request_id: null,
    event_fingerprint: fingerprint,
    conversation_id: `${accountId}:${event.message_type}:${groupId ?? senderId}`,
    conversation_type: event.message_type, group_id: groupId,
    peer_user_id: groupId ? null : senderId, sender_id: senderId,
    sender_name: event.sender?.nickname ?? null, sender_card: event.sender?.card ?? null,
    sent_at: sentAt, received_at: new Date().toISOString(), plain_text: text,
    raw_message: event.message ?? null, segments, reply_to_message_id: null,
    at_users: atUsers, at_me: atMe, at_all: atAll,
    priority: priorityFor(scoreBounded), priority_score: scoreBounded,
    requires_reply: false, urgent: false, deadline: null, raw_event: event,
  };
}

export function safeTokenEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected); const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
