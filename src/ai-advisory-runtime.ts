import { classifyIncomingMessage, type ClassificationIngressOptions } from './ai-classification-ingress.js';
import type { MessageClassifier } from './ai-classification.js';
import type { AiAdvisoryInput, AiAdvisoryRecord } from './ai-advisory-store.js';
import type { NormalizedMessage } from './normalize.js';

export type AiAdvisoryRecorder = Pick<{ record(input: AiAdvisoryInput): Promise<AiAdvisoryRecord> }, 'record'>;
export type AiAdvisoryRuntimePolicy = Readonly<{ enabled: boolean; accountId: string; labels: readonly string[]; model: string; policyVersion: string; threshold?: number; minTextChars?: number; redactSensitive?: boolean }>;

/** Best-effort metadata-only persistence for opted-in, newly inserted incoming messages. */
export async function persistIncomingAiAdvisory(message: Pick<NormalizedMessage, 'id' | 'account_id' | 'direction' | 'plain_text'>, newlyInserted: boolean, policy: AiAdvisoryRuntimePolicy | undefined, classifier: MessageClassifier | undefined, store: AiAdvisoryRecorder | undefined): Promise<AiAdvisoryRecord | undefined> {
  if (!newlyInserted || policy?.enabled !== true || !classifier || !store || message.direction !== 'incoming' || message.account_id !== policy.accountId) return undefined;
  if (!validField(policy.accountId) || !validField(policy.model) || !validField(policy.policyVersion)) return undefined;
  try {
    const result = await classifyIncomingMessage(message, {
      enabled: true,
      labels: policy.labels,
      ...(policy.threshold === undefined ? {} : { threshold: policy.threshold }),
      ...(policy.minTextChars === undefined ? {} : { minTextChars: policy.minTextChars }),
      ...(policy.redactSensitive === undefined ? {} : { redactSensitive: policy.redactSensitive }),
    } satisfies ClassificationIngressOptions, classifier);
    if (!result) return undefined;
    return await store.record({ accountId: policy.accountId, messageId: message.id, label: result.label, confidence: result.confidence, model: policy.model, policyVersion: policy.policyVersion });
  } catch { return undefined; }
}
function validField(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.trim() === value && value.length <= 128; }
