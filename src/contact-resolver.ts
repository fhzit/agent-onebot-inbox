export type Contact = {
  account_id: string;
  qq_id: string;
  nickname?: string | null;
  remark?: string | null;
  card?: string | null;
  group_id?: string | null;
};
export type ContactResolution =
  | { status: 'resolved'; contact: Contact; candidates: Contact[] }
  | { status: 'ambiguous'; contact: null; candidates: Contact[] }
  | { status: 'not_found'; contact: null; candidates: [] };

/** Exact, account-aware resolver. Ambiguity is returned, never guessed. */
export function resolveContact(contacts: readonly Contact[], accountId: string | undefined, query: string): ContactResolution {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return { status: 'not_found', contact: null, candidates: [] };
  const candidates = contacts.filter(contact => (!accountId || contact.account_id === accountId) &&
    [contact.qq_id, contact.nickname, contact.remark, contact.card].some(value => value?.trim().toLocaleLowerCase() === term));
  const unique = [...new Map(candidates.map(c => [`${c.account_id}:${c.qq_id}:${c.group_id ?? ''}`, c])).values()];
  if (unique.length === 1) return { status: 'resolved', contact: unique[0]!, candidates: unique };
  if (unique.length > 1) return { status: 'ambiguous', contact: null, candidates: unique };
  return { status: 'not_found', contact: null, candidates: [] };
}
