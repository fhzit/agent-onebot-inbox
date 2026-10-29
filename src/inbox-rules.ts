import type { NormalizedMessage } from './normalize.js';

export type InboxRule = {
  id: string;
  enabled?: boolean;
  accountIds?: string[];
  conversationTypes?: Array<'private' | 'group'>;
  senderIds?: string[];
  groupIds?: string[];
  keywords?: string[];
  atMe?: boolean;
  action: 'mark_processed' | 'dismiss' | 'require_reply' | 'urgent';
};
export type InboxRuleMatch = { ruleId: string; action: InboxRule['action'] };

export async function applyInboxRules(message: NormalizedMessage, rules: readonly InboxRule[], store: { markProcessed(id: string): unknown | Promise<unknown>; dismiss(id: string): unknown | Promise<unknown> }): Promise<InboxRuleMatch[]> {
  const matches = evaluateInboxRules(message, rules);
  for (const match of matches) {
    if (match.action === 'mark_processed') await store.markProcessed(message.id);
    else if (match.action === 'dismiss') await store.dismiss(message.id);
  }
  return matches;
}

/** Evaluate rules deterministically without mutating the stored/provider message. */
export function evaluateInboxRules(message: NormalizedMessage, rules: readonly InboxRule[]): InboxRuleMatch[] {
  const text = message.plain_text.toLocaleLowerCase();
  const matches: InboxRuleMatch[] = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.accountIds && !rule.accountIds.includes(message.account_id)) continue;
    if (rule.conversationTypes && !rule.conversationTypes.includes(message.conversation_type)) continue;
    if (rule.senderIds && !rule.senderIds.includes(message.sender_id)) continue;
    if (rule.groupIds && (message.group_id === null || !rule.groupIds.includes(message.group_id))) continue;
    if (rule.atMe === true && !message.at_me) continue;
    if (rule.keywords && !rule.keywords.some(k => k.length > 0 && text.includes(k.toLocaleLowerCase()))) continue;
    matches.push({ ruleId: rule.id, action: rule.action });
  }
  return matches;
}
