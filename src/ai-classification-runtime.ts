import { classifyMessage, type Classification, type MessageClassifier } from './ai-classification.js';

export type ClassificationRuntimePolicy = Readonly<{
  enabled: boolean;
  labels: readonly string[];
  minTextChars?: number;
  shouldClassify?: (message: Readonly<{ id: string; direction: string; plain_text: string }>) => boolean;
}>;

/** Optional ingress enrichment boundary. Disabled or unconfigured means zero provider calls. */
export async function enrichMessageClassification(
  message: Readonly<{ id: string; direction: string; plain_text: string }>,
  policy: ClassificationRuntimePolicy | undefined,
  classifier: MessageClassifier | undefined,
): Promise<Classification | undefined> {
  if (!policy?.enabled || !classifier || message.direction !== 'incoming' || !message.plain_text.trim()) return undefined;
  if (policy.shouldClassify && !policy.shouldClassify(message)) return undefined;
  const minTextChars = policy.minTextChars ?? 1;
  if (!Number.isInteger(minTextChars) || minTextChars < 1 || minTextChars > 8_000)
    throw new RangeError('minTextChars must be an integer from 1 to 8000');
  if (message.plain_text.trim().length < minTextChars) return undefined;
  try {
    return await classifyMessage(classifier, { messageId: message.id, text: message.plain_text, labels: policy.labels });
  } catch {
    // Classification is advisory; provider and malformed-output failures never reject ingress.
    return undefined;
  }
}
