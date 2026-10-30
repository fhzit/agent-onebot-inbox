import { PROVIDER_QUALIFICATION_CHECKLIST, type QualificationState } from './provider-qualification.js';

export interface QualificationEvidenceInput {
  id: unknown;
  status: unknown;
  evidence?: unknown;
}

export interface ValidatedQualificationEvidence {
  id: string;
  status: QualificationState;
  evidence?: string;
}

const MAX_EVIDENCE_LENGTH = 8_192;
const MAX_VERSION_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Validate and normalize evidence while retaining it only as operator-provided text. */
export function validateQualificationEvidence(
  input: QualificationEvidenceInput,
): ValidatedQualificationEvidence {
  if (!input || typeof input.id !== 'string' || typeof input.status !== 'string' ||
      !['pass', 'fail', 'unverified'].includes(input.status)) {
    throw new TypeError('Invalid qualification check');
  }
  const id = input.id.trim();
  if (!id) throw new TypeError('Qualification check id is required');
  const status = input.status as QualificationState;
  const evidence = input.evidence;
  if (evidence !== undefined && typeof evidence !== 'string') {
    throw new TypeError('Evidence must be text');
  }
  if (typeof evidence === 'string') {
    if (evidence.length > MAX_EVIDENCE_LENGTH) throw new TypeError('Evidence is too long');
    if (CONTROL_CHARACTERS.test(evidence)) throw new TypeError('Evidence contains control characters');
    if (status !== 'unverified' && !evidence.trim()) throw new TypeError('Pass/fail results require non-empty evidence');
  } else if (status !== 'unverified') {
    throw new TypeError('Pass/fail results require evidence');
  }
  return Object.freeze({ id, status, ...(evidence === undefined ? {} : { evidence: evidence.trim() }) });
}

/** Validate provider/version/check uniqueness before persisting a qualification record. */
export function validateProviderQualificationInput(input: {
  provider: unknown;
  version: unknown;
  checks: unknown;
}): { provider: string; version: string; checks: readonly ValidatedQualificationEvidence[] } {
  if (!input || typeof input.provider !== 'string' || typeof input.version !== 'string' || !Array.isArray(input.checks)) {
    throw new TypeError('Qualification record must include provider, version, and checks');
  }
  const provider = input.provider.trim().toLowerCase();
  const version = input.version.trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider)) throw new TypeError('Invalid provider identifier');
  if (!version || version.length > MAX_VERSION_LENGTH || version.includes('/') || version.includes('\\') || CONTROL_CHARACTERS.test(version)) throw new TypeError('Invalid provider version');
  const checklist = PROVIDER_QUALIFICATION_CHECKLIST[provider];
  if (!checklist) throw new TypeError(`Unknown provider: ${provider}`);
  const seen = new Set<string>();
  const checks = input.checks.map((raw: unknown) => {
    const checked = validateQualificationEvidence(raw as QualificationEvidenceInput);
    if (seen.has(checked.id) || !checklist.some(candidate => candidate.id === checked.id)) {
      throw new TypeError(`Unknown or duplicate qualification check: ${checked.id}`);
    }
    seen.add(checked.id);
    return checked;
  });
  return Object.freeze({ provider, version, checks: Object.freeze(checks) });
}
