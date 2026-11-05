import { decideClassification } from './ai-classification-policy.js';
import type { AiAdvisoryInput } from './ai-advisory-store.js';

export const AI_ADVISORY_POLICY_VERSION = 'ai-advisory-v1';

/** Explicit account-level consent; absence/false can never enable durable metadata writes. */
export type AiAdvisoryConsent = Readonly<{ enabled: true; accountId: string }>;
export type AiAdvisoryPersistenceOptions = Readonly<{
  consent?: AiAdvisoryConsent;
  messageId: string;
  newlyInserted: boolean;
  allowedLabels: readonly string[];
  model: string;
  policyVersion?: string;
}>;

/** Forward only validated metadata for explicitly opted-in, newly inserted messages. */
export async function persistAiAdvisoryIfAllowed(
  result: unknown,
  options: AiAdvisoryPersistenceOptions,
  persist: (input: AiAdvisoryInput) => Promise<unknown> | unknown,
): Promise<boolean> {
  if (!options || options.consent?.enabled !== true || !options.newlyInserted) return false;
  const { accountId } = options.consent;
  const { messageId, model, allowedLabels } = options;
  if (!validField(accountId) || !validField(messageId) || !validField(model) || model.length > 128) return false;
  if (!Array.isArray(allowedLabels) || allowedLabels.length < 1 || allowedLabels.length > 32) return false;
  const policyVersion = options.policyVersion ?? AI_ADVISORY_POLICY_VERSION;
  if (!validField(policyVersion) || policyVersion.length > 128) return false;

  const decision = decideClassification(result, allowedLabels);
  if (decision.kind !== 'classified') return false;
  await persist({ accountId, messageId, label: decision.label, confidence: decision.confidence, model, policyVersion });
  return true;
}

function validField(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= 128;
}
