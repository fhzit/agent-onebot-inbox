import type { NormalizedMessage } from './normalize.js';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type PriorityRule = {
  id: string;
  kind?: 'weighted' | 'hard';
  weight?: number;
  priority?: Priority;
  accountIds?: string[];
  conversationTypes?: Array<'private' | 'group'>;
  groupIds?: string[];
  senderIds?: string[];
  keywords?: string[];
  atMe?: boolean;
};
export type WatchPerson = { userId: string; boost: number; accountIds?: string[] };
export type PriorityInput = {
  accountId: string; conversationType: 'private' | 'group'; groupId?: string | null;
  senderId: string; text: string; atMe: boolean; atAll: boolean; baseScore?: number;
  override?: { priority: Priority };
};
export type PriorityConfig = { rules: PriorityRule[]; watchPeople: WatchPerson[] };
export type PriorityResult = { score: number; priority: Priority; matchedRules: string[]; overridden: boolean };

export function priorityForScore(score: number): Priority {
  if (score >= 80) return 'P0';
  if (score >= 60) return 'P1';
  if (score >= 35) return 'P2';
  if (score >= 15) return 'P3';
  return 'P4';
}
function scopeMatches(scope: { accountIds?: string[] }, accountId: string): boolean {
  return !scope.accountIds || scope.accountIds.includes(accountId);
}
function matches(rule: PriorityRule, input: PriorityInput): boolean {
  return scopeMatches(rule, input.accountId)
    && (!rule.conversationTypes || rule.conversationTypes.includes(input.conversationType))
    && (!rule.groupIds || (input.groupId != null && rule.groupIds.includes(input.groupId)))
    && (!rule.senderIds || rule.senderIds.includes(input.senderId))
    && (rule.atMe !== true || (input.atMe && !input.atAll))
    && (!rule.keywords || rule.keywords.some(k => k.length > 0 && input.text.toLocaleLowerCase().includes(k.toLocaleLowerCase())));
}
export function applyPriority(message: NormalizedMessage, config: PriorityConfig, override?: { priority: Priority }): NormalizedMessage {
  const result = scorePriority({ accountId: message.account_id, conversationType: message.conversation_type, groupId: message.group_id, senderId: message.sender_id, text: message.plain_text, atMe: message.at_me, atAll: message.at_all, baseScore: message.priority_score, ...(override ? { override } : {}) }, config);
  return { ...message, priority: result.priority, priority_score: result.score };
}
export function scorePriority(input: PriorityInput, config: PriorityConfig): PriorityResult {
  if (input.override) return { score: input.override.priority === 'P0' ? 100 : input.override.priority === 'P1' ? 70 : input.override.priority === 'P2' ? 45 : input.override.priority === 'P3' ? 20 : 0, priority: input.override.priority, matchedRules: [], overridden: true };
  const hard = config.rules.find(r => r.kind === 'hard' && r.priority && matches(r, input));
  if (hard?.priority) return { score: hard.priority === 'P0' ? 100 : hard.priority === 'P1' ? 70 : hard.priority === 'P2' ? 45 : hard.priority === 'P3' ? 20 : 0, priority: hard.priority, matchedRules: [hard.id], overridden: true };
  let score = input.baseScore ?? 0;
  const matchedRules: string[] = [];
  for (const rule of config.rules) if ((rule.kind ?? 'weighted') === 'weighted' && matches(rule, input)) { score += rule.weight ?? 0; matchedRules.push(rule.id); }
  for (const person of config.watchPeople) if (person.userId === input.senderId && scopeMatches(person, input.accountId)) score += person.boost;
  score = Math.max(0, Math.min(100, score));
  return { score, priority: priorityForScore(score), matchedRules, overridden: false };
}
