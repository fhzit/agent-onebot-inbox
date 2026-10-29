import { resolveContact } from './contact-resolver.js';
import type { Contact } from './contact-resolver.js';

export type ContactSendTargetContact = Contact;

export type ContactSendTargetResolution =
  | { status: 'resolved'; targetId: string; source: 'explicit' | 'recipient' }
  | { status: 'ambiguous'; targetId: null }
  | { status: 'not_found'; targetId: null }
  | { status: 'mismatch'; targetId: null }
  | { status: 'invalid'; targetId: null };

export type ResolveContactSendTargetInput = {
  accountId?: string;
  explicitTargetId?: string;
  recipient?: string;
  contacts: readonly ContactSendTargetContact[];
};

/** Resolve a send target without guessing or altering identifier meaning. */
export function resolveContactSendTarget(input: ResolveContactSendTargetInput): ContactSendTargetResolution {
  const explicit = input.explicitTargetId;
  const hasExplicit = explicit !== undefined;
  const explicitId = hasExplicit ? explicit.trim() : undefined;

  if (hasExplicit && (!explicitId || /[,;\s]/.test(explicitId))) {
    return { status: 'invalid', targetId: null };
  }

  const hasRecipient = input.recipient !== undefined;
  if (!hasExplicit && !hasRecipient) return { status: 'invalid', targetId: null };

  if (hasRecipient && !input.recipient!.trim()) {
    return { status: 'invalid', targetId: null };
  }

  if (!hasRecipient) {
    return { status: 'resolved', targetId: explicitId!, source: 'explicit' };
  }

  const resolution = resolveContact(input.contacts, input.accountId, input.recipient!);
  if (resolution.status === 'ambiguous') return { status: 'ambiguous', targetId: null };
  if (resolution.status === 'not_found') {
    // An explicit target remains authoritative when the accompanying recipient
    // is not in the contact snapshot; only a known conflicting recipient mismatches.
    return hasExplicit
      ? { status: 'resolved', targetId: explicitId!, source: 'explicit' }
      : { status: 'not_found', targetId: null };
  }

  const resolvedId = resolution.contact.qq_id;
  if (hasExplicit && explicitId !== resolvedId) return { status: 'mismatch', targetId: null };
  return { status: 'resolved', targetId: hasExplicit ? explicitId! : resolvedId, source: hasExplicit ? 'explicit' : 'recipient' };
}
