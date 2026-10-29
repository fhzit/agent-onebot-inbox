export type NamedContact = Readonly<{ userId: string; displayName?: string | null }>;

export type ContactNameResolution =
  | { kind: 'resolved'; userId: string }
  | { kind: 'not-found' }
  | { kind: 'ambiguous'; candidateCount: number };

/** Exact, case-insensitive name matching. Ambiguous names never silently select a recipient. */
export function resolveContactName(contacts: readonly NamedContact[], query: string): ContactNameResolution {
  if (typeof query !== 'string' || !query.trim()) return { kind: 'not-found' };
  const normalized = query.trim().toLocaleLowerCase();
  const matches = new Map<string, NamedContact>();
  for (const contact of contacts) {
    if (typeof contact.userId !== 'string' || !contact.userId.trim()) continue;
    const names = [contact.userId, contact.displayName ?? ''];
    if (names.some(name => typeof name === 'string' && name.trim().toLocaleLowerCase() === normalized)) {
      matches.set(contact.userId, contact);
    }
  }
  if (matches.size === 0) return { kind: 'not-found' };
  if (matches.size > 1) return { kind: 'ambiguous', candidateCount: matches.size };
  return { kind: 'resolved', userId: matches.keys().next().value! };
}
