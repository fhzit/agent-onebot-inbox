import { validateProviderQualificationInput } from './provider-qualification-validation.js';
import type { QualificationState } from './provider-qualification.js';

export interface QualificationCheckResult {
  id: string;
  status: QualificationState;
  /** Evidence is mandatory for pass/fail; do not store secrets or unredacted user data. */
  evidence?: string;
}

export interface ProviderQualificationRecordInput {
  provider: string;
  version: string;
  checks: readonly QualificationCheckResult[];
}

export interface ProviderQualificationCheckRecord extends QualificationCheckResult {
  providerTested: boolean;
}

export interface ProviderQualificationRecord {
  provider: string;
  version: string;
  checks: readonly ProviderQualificationCheckRecord[];
  recordedAt: string;
}

export interface ProviderQualificationResultStore {
  record(input: ProviderQualificationRecordInput): ProviderQualificationRecord | Promise<ProviderQualificationRecord>;
  get(provider: string, version: string): ProviderQualificationRecord | undefined | Promise<ProviderQualificationRecord | undefined>;
}

/** In-memory, version-specific results; recording a result does not test a provider. */
export class ProviderQualificationStore implements ProviderQualificationResultStore {
  private readonly records = new Map<string, ProviderQualificationRecord>();

  record(input: ProviderQualificationRecordInput): ProviderQualificationRecord {
    const validated = validateProviderQualificationInput(input);
    const checks = validated.checks.map(check => Object.freeze({ ...check, providerTested: check.status !== 'unverified' }));
    const record = Object.freeze({ provider: validated.provider, version: validated.version, checks: Object.freeze(checks), recordedAt: new Date().toISOString() });
    this.records.set(this.key(validated.provider, validated.version), record);
    return record;
  }

  get(provider: string, version: string): ProviderQualificationRecord | undefined {
    if (typeof provider !== 'string' || typeof version !== 'string') return undefined;
    return this.records.get(this.key(provider.trim().toLowerCase(), version.trim()));
  }

  private key(provider: string, version: string): string {
    return `${provider}\u0000${version}`;
  }
}
