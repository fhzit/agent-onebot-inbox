import type { QualificationState } from './provider-qualification.js';

export interface QualificationLifecycleCheck {
  id: string;
  status: QualificationState;
  evidence?: string;
  providerTested?: boolean;
}

export interface QualificationLifecycleRecord {
  provider: string;
  version: string;
  checks: readonly QualificationLifecycleCheck[];
  recordedAt: string;
  expiresAt?: string;
}

export type QualificationLifecycleState = 'qualified' | 'unverified' | 'expired';

/** Qualification is current only when every required check has explicit, tested passing evidence. */
export function getQualificationLifecycleState(
  record: QualificationLifecycleRecord | undefined,
  requiredCheckIds: readonly string[],
  now: Date = new Date(),
): QualificationLifecycleState {
  if (!record) return 'unverified';
  const recordedAt = Date.parse(record.recordedAt);
  if (!Number.isFinite(recordedAt) || recordedAt > now.getTime()) return 'unverified';
  if (record.expiresAt !== undefined) {
    const expiresAt = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return 'expired';
  }
  const byId = new Map(record.checks.map(check => [check.id, check]));
  if (requiredCheckIds.length === 0 || new Set(requiredCheckIds).size !== requiredCheckIds.length) return 'unverified';
  for (const id of requiredCheckIds) {
    const check = byId.get(id);
    if (!check || check.status !== 'pass' || check.providerTested !== true || !check.evidence?.trim()) return 'unverified';
  }
  return 'qualified';
}
