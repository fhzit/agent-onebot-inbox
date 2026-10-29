/** Provider-neutral, bounded contract for optional message classification. No model is bundled. */
export const MAX_CLASSIFICATION_TEXT_CHARS = 8_000;
export const MAX_CLASSIFICATION_LABEL_CHARS = 64;
export const MAX_CLASSIFICATION_REASON_CHARS = 240;

export type ClassificationInput = {
  messageId: string;
  text: string;
  labels: readonly string[];
};

export type Classification = {
  label: string;
  confidence: number;
  reason?: string;
};

/** Adapter contract: implementations may call a model, but must return structured data. */
export interface MessageClassifier {
  classify(input: Readonly<ClassificationInput>): Promise<unknown>;
}

/** Validates bounds both before invoking an adapter and after receiving its output. */
export async function classifyMessage(
  classifier: MessageClassifier,
  input: ClassificationInput,
): Promise<Classification> {
  if (typeof input.messageId !== 'string' || !input.messageId.trim() || input.messageId.length > 256)
    throw new TypeError('messageId must be a non-empty string of at most 256 characters');
  if (typeof input.text !== 'string' || input.text.length > MAX_CLASSIFICATION_TEXT_CHARS)
    throw new RangeError(`text must be at most ${MAX_CLASSIFICATION_TEXT_CHARS} characters`);
  if (!Array.isArray(input.labels) || input.labels.length < 1 || input.labels.length > 32)
    throw new RangeError('labels must contain between 1 and 32 entries');
  const labels = input.labels.map(label => {
    if (typeof label !== 'string' || !label.trim() || label.length > MAX_CLASSIFICATION_LABEL_CHARS)
      throw new TypeError(`each label must be non-empty and at most ${MAX_CLASSIFICATION_LABEL_CHARS} characters`);
    return label.trim();
  });
  if (new Set(labels).size !== labels.length) throw new TypeError('labels must be unique');

  const value = await classifier.classify({ messageId: input.messageId.trim(), text: input.text, labels });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('classifier returned an invalid result');
  const result = value as Record<string, unknown>;
  if (typeof result.label !== 'string' || !labels.includes(result.label)) throw new TypeError('classifier returned an unknown label');
  if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1)
    throw new TypeError('classifier confidence must be between 0 and 1');
  if (result.reason !== undefined && (typeof result.reason !== 'string' || result.reason.length > MAX_CLASSIFICATION_REASON_CHARS))
    throw new TypeError(`classifier reason must be at most ${MAX_CLASSIFICATION_REASON_CHARS} characters`);
  return { label: result.label, confidence: result.confidence, ...(result.reason === undefined ? {} : { reason: result.reason }) };
}
