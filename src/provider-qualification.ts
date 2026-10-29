/**
 * Machine-readable live qualification checklist for OneBot providers.
 * Entries are prompts to collect evidence, not compatibility claims. Keep all
 * provider states unverified until a version-specific live check is recorded.
 */

export type QualificationState = 'unverified' | 'pass' | 'fail';
export type QualificationDirection = 'inbound' | 'outbound' | 'transport';

export interface ProviderQualificationCheck {
  id: string;
  direction: QualificationDirection;
  capability: string;
  verification: QualificationState;
  failClosed: boolean;
  requiredEvidence: string;
}

const CHECKS: readonly Omit<ProviderQualificationCheck, 'verification'>[] = [
  { id: 'transport.reverse-ws-auth', direction: 'transport', capability: 'Reverse WebSocket connection and token authentication', failClosed: true, requiredEvidence: 'Provider name/version, connection logs, authenticated handshake result' },
  { id: 'inbound.private-message', direction: 'inbound', capability: 'Private message event parsing and account attribution', failClosed: true, requiredEvidence: 'Redacted raw event and normalized event from a controlled test account' },
  { id: 'inbound.group-message', direction: 'inbound', capability: 'Group message event parsing and group/sender attribution', failClosed: true, requiredEvidence: 'Redacted raw event and normalized event from a controlled test group' },
  { id: 'inbound.reconnect', direction: 'inbound', capability: 'Reconnect behavior and duplicate-event handling', failClosed: true, requiredEvidence: 'Observed disconnect/reconnect sequence and event deduplication result' },
  { id: 'outbound.private-text', direction: 'outbound', capability: 'Private text send action and response envelope', failClosed: true, requiredEvidence: 'Request, provider response, and recipient-side receipt for a harmless test' },
  { id: 'outbound.group-text', direction: 'outbound', capability: 'Group text send action and response envelope', failClosed: true, requiredEvidence: 'Request, provider response, and group-side receipt for a harmless test' },
  { id: 'outbound.revoke', direction: 'outbound', capability: 'Revoke a known outgoing message', failClosed: true, requiredEvidence: 'Known outgoing message ID, request/response, and observed revoke result' },
  { id: 'outbound.file-upload', direction: 'outbound', capability: 'File upload action and subsequent file send', failClosed: true, requiredEvidence: 'Provider/version-specific upload request/response and recipient-side receipt' },
];

export const PROVIDER_QUALIFICATION_CHECKLIST: Readonly<Record<string, readonly ProviderQualificationCheck[]>> = Object.freeze({
  napcat: Object.freeze(CHECKS.map(check => Object.freeze({ ...check, verification: 'unverified' as const }))),
  snowluma: Object.freeze(CHECKS.map(check => Object.freeze({ ...check, verification: 'unverified' as const }))),
});

/** Unknown providers/capabilities and every unqualified check fail closed. */
export function isProviderCapabilityQualified(provider: string, checkId: string): boolean {
  const checks = PROVIDER_QUALIFICATION_CHECKLIST[provider.trim().toLowerCase()];
  const check = checks?.find(candidate => candidate.id === checkId);
  return check?.verification === 'pass';
}
