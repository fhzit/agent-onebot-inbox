import type { Segment } from './normalize.js';

export const SEND_INTENT_MAX_SEGMENTS = 100;

export interface SendIntentInput {
  accountId: string;
  type: 'private' | 'group';
  targetId: string;
  message: string | Segment[];
}

export interface SendIntentValidation {
  valid: true;
  providerEffects: false;
  accountId: string;
  type: 'private' | 'group';
  targetId: string;
  segmentCount: number;
}

/** Validate an explicit send intent locally; never resolves recipients or contacts a provider. */
export function validateSendIntentDryRun(input: SendIntentInput): SendIntentValidation {
  if (!input || typeof input !== 'object') throw new Error('Send intent is required');
  if (typeof input.accountId !== 'string' || !input.accountId.trim()) throw new Error('An explicit account ID is required');
  if (input.type !== 'private' && input.type !== 'group') throw new Error('Target type must be private or group');
  if (typeof input.targetId !== 'string' || !input.targetId.trim()) throw new Error(`An explicit ${input.type} target ID is required`);
  if (/[\s,;]/.test(input.targetId.trim())) throw new Error('Ambiguous recipient; provide exactly one explicit target ID');
  if (typeof input.message !== 'string' && !Array.isArray(input.message)) throw new Error('Message must be text or a segment array');
  const segments: Segment[] = typeof input.message === 'string' ? [{ type: 'text', data: { text: input.message } }] : input.message;
  if (segments.length === 0) throw new Error('Message must contain at least one segment');
  if (segments.length > SEND_INTENT_MAX_SEGMENTS) throw new Error(`Message exceeds the ${SEND_INTENT_MAX_SEGMENTS}-segment limit`);
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object' || typeof segment.type !== 'string' || !segment.type.trim() || !segment.data || typeof segment.data !== 'object' || Array.isArray(segment.data)) {
      throw new Error('Each message segment must have a type and data object');
    }
  }
  return { valid: true, providerEffects: false, accountId: input.accountId.trim(), type: input.type, targetId: input.targetId.trim(), segmentCount: segments.length };
}
