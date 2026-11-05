import { loadConfig } from './config.js';
import { productionRequiresDatabase } from './startup-policy.js';
import { startServer, type Runtime } from './server.js';
import { createHttpMessageClassifier } from './ai-classification-http.js';
import { AI_ADVISORY_POLICY_VERSION } from './ai-advisory-policy.js';
import type { ClassificationIngressOptions } from './ai-classification-ingress.js';

const config = loadConfig();
const requireDatabase = productionRequiresDatabase(process.env.NODE_ENV) || process.env.REQUIRE_DATABASE === 'true';
const advisoryEnabled = process.env.AI_ADVISORIES_ENABLED === 'true';
const advisoryClassifierConfig = advisoryEnabled ? {
  endpoint: process.env.AI_CLASSIFIER_ENDPOINT,
  apiKey: process.env.AI_CLASSIFIER_API_KEY,
  model: process.env.AI_CLASSIFIER_MODEL,
  accountIds: process.env.AI_ADVISORY_ACCOUNT_IDS?.split(',').map(id => id.trim()).filter(Boolean),
  labels: process.env.AI_ADVISORY_LABELS?.split(',').map(label => label.trim()).filter(Boolean),
} : undefined;
let aiAdvisories: NonNullable<Parameters<typeof startServer>[3]>['aiAdvisories'];
if (advisoryEnabled) {
  if (!advisoryClassifierConfig?.endpoint || !advisoryClassifierConfig.model || !advisoryClassifierConfig.accountIds?.length || !advisoryClassifierConfig.labels?.length || !process.env.DATABASE_URL) {
    throw new Error('AI advisory opt-in requires AI_CLASSIFIER_ENDPOINT, AI_CLASSIFIER_MODEL, AI_ADVISORY_ACCOUNT_IDS, AI_ADVISORY_LABELS, and DATABASE_URL');
  }
  let classifierUrl: URL;
  try {
    classifierUrl = new URL(advisoryClassifierConfig.endpoint);
  } catch {
    throw new Error('AI_CLASSIFIER_ENDPOINT must be a valid HTTPS URL');
  }
  if (classifierUrl.protocol !== 'https:') {
    throw new Error('AI_CLASSIFIER_ENDPOINT must use HTTPS');
  }
  const policy: ClassificationIngressOptions = { enabled: true, labels: advisoryClassifierConfig.labels, redactSensitive: true };
  const classifier = createHttpMessageClassifier({ endpoint: advisoryClassifierConfig.endpoint, model: advisoryClassifierConfig.model, ...(advisoryClassifierConfig.apiKey ? { apiKey: advisoryClassifierConfig.apiKey } : {}) });
  aiAdvisories = { enabled: true, accountIds: advisoryClassifierConfig.accountIds, model: advisoryClassifierConfig.model, policyVersion: AI_ADVISORY_POLICY_VERSION, policy, classifier };
}
const retentionEnabled = process.env.AI_ADVISORY_RETENTION_ENABLED === 'true';
const aiAdvisoryRetention = retentionEnabled ? { version: process.env.AI_ADVISORY_RETENTION_POLICY_VERSION, retentionDays: Number(process.env.AI_ADVISORY_RETENTION_DAYS), batchSize: Number(process.env.AI_ADVISORY_RETENTION_BATCH_SIZE) } : undefined;
if (retentionEnabled && (!process.env.DATABASE_URL || !process.env.AI_ADVISORY_RETENTION_POLICY_VERSION || !process.env.AI_ADVISORY_RETENTION_DAYS || !process.env.AI_ADVISORY_RETENTION_BATCH_SIZE)) throw new Error('Retention requires DATABASE_URL and explicit policy version, retention days, and batch size');
const runtime = await startServer(config, undefined, { rules: [], watchPeople: [] }, { ...(aiAdvisoryRetention ? { aiAdvisoryRetention } : {}), requireDatabase, ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}), ...(process.env.ACCOUNT_ENCRYPTION_KEY ? { accountEncryptionKey: process.env.ACCOUNT_ENCRYPTION_KEY } : {}), ...(aiAdvisories ? { aiAdvisories } : {}) });
const shutdown = async () => { await runtime.close(); process.exit(0); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
