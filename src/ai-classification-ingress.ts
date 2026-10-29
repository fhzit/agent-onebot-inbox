import { classifyMessage, type Classification, type MessageClassifier } from './ai-classification.js';
import { decideClassification } from './ai-classification-policy.js';
import type { NormalizedMessage } from './normalize.js';

export type ClassificationIngressOptions = Readonly<{
  /** Must be explicitly true; undefined/false is always a no-op. */
  enabled?: boolean;
  labels: readonly string[];
  threshold?: number;
  minTextChars?: number;
  /** Replace common contact details and credential-like strings before provider dispatch. */
  redactSensitive?: boolean;
}>;

/** Advisory-only ingress adapter. It neither mutates the message nor persists/emits results. */
export async function classifyIncomingMessage(
  message: Pick<NormalizedMessage, 'id' | 'direction' | 'plain_text'>,
  options: ClassificationIngressOptions | undefined,
  classifier: MessageClassifier | undefined,
): Promise<Classification | undefined> {
  if (options?.enabled !== true || !classifier || !message || message.direction !== 'incoming') return undefined;
  if (!Array.isArray(options.labels) || options.labels.length < 1 || options.labels.length > 32) return undefined;
  if (typeof message.id !== 'string' || !message.id.trim() || message.id.length > 256 || typeof message.plain_text !== 'string') return undefined;
  const text = message.plain_text;
  if (!text.trim() || text.length > 8_000) return undefined;
  const min = options.minTextChars ?? 1;
  if (!Number.isInteger(min) || min < 1 || min > 8_000) return undefined;
  if (options.threshold !== undefined && (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1)) return undefined;
  if (typeof options.redactSensitive !== 'undefined' && typeof options.redactSensitive !== 'boolean') return undefined;
  if (text.trim().length < min) return undefined;
  const labels = options.labels.map(label => {
    if (typeof label !== 'string' || !label.trim() || label.length > 64) return undefined;
    return label.trim();
  });
  if (labels.some(label => label === undefined) || new Set(labels).size !== labels.length) return undefined;
  const safeText = options.redactSensitive ? redactSensitiveText(text) : text;
  if (!safeText.trim() || safeText.length > 8_000) return undefined;
  try {
    const result = await classifyMessage(classifier, { messageId: message.id, text: safeText, labels: labels as string[] });
    const decision = decideClassification(result, labels as string[], options.threshold);
    return decision.kind === 'classified' ? result : undefined;
  } catch {
    // Classification is optional: invalid config, provider errors, and malformed output abstain.
    return undefined;
  }
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/(?:\+?\d[\d .()/-]{7,}\d)/g, '[REDACTED_PHONE]')
    .replace(/\b(?:password|passwd|token|api[_ -]?key|secret)\s*[:=]\s*\S+/gi, '[REDACTED_SECRET]');
}
