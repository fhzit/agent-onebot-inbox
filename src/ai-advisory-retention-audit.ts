/** Storage-agnostic, privacy-safe audit events for retention preview/apply attempts. */

export type RetentionAuditAction = 'preview' | 'apply';
export type RetentionAuditOutcome = 'success' | 'partial' | 'failure';

/** Only bounded identifiers, policy metadata, counts and categorized errors belong here. */
export type RetentionAuditEvent = Readonly<{
  eventId: string;
  occurredAt: string;
  action: RetentionAuditAction;
  actorId: string;
  accountId: string;
  cutoff: string;
  retentionDays: number;
  policyVersion: string;
  requestedLimit: number;
  candidateCount: number;
  requestedCount: number;
  deletedCount: number | null;
  outcome: RetentionAuditOutcome;
  errorCategory: string | null;
}>;

export type RetentionAuditInput = Omit<RetentionAuditEvent, 'occurredAt'> & { occurredAt?: string };
export type RetentionAuditSink = (event: RetentionAuditEvent) => void | Promise<void>;

/** Validate, freeze, and emit a minimal event. Sink errors propagate (fail closed). */
export async function emitRetentionAuditEvent(sink: RetentionAuditSink, input: RetentionAuditInput): Promise<RetentionAuditEvent> {
  if (typeof sink !== 'function') throw new TypeError('audit sink is required');
  const event: RetentionAuditEvent = Object.freeze({
    eventId: identifier(input.eventId, 'eventId'),
    occurredAt: timestamp(input.occurredAt ?? new Date().toISOString(), 'occurredAt'),
    action: oneOf(input.action, ['preview', 'apply'], 'action'),
    actorId: identifier(input.actorId, 'actorId'),
    accountId: identifier(input.accountId, 'accountId'),
    cutoff: timestamp(input.cutoff, 'cutoff'),
    retentionDays: count(input.retentionDays, 'retentionDays', 1),
    policyVersion: identifier(input.policyVersion, 'policyVersion'),
    requestedLimit: count(input.requestedLimit, 'requestedLimit', 1),
    candidateCount: count(input.candidateCount, 'candidateCount'),
    requestedCount: count(input.requestedCount, 'requestedCount'),
    deletedCount: input.deletedCount === null ? null : count(input.deletedCount, 'deletedCount'),
    outcome: oneOf(input.outcome, ['success', 'partial', 'failure'], 'outcome'),
    errorCategory: input.errorCategory === null ? null : identifier(input.errorCategory, 'errorCategory'),
  });
  if (event.action === 'preview' && (event.requestedCount !== 0 || event.deletedCount !== null)) throw new TypeError('preview cannot report apply counts');
  if (event.action === 'apply' && event.deletedCount !== null && event.deletedCount > event.requestedCount) throw new RangeError('deletedCount exceeds requestedCount');
  if (event.outcome === 'failure' && !event.errorCategory) throw new TypeError('failure requires an error category');
  await sink(event);
  return event;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 128) throw new TypeError(`${name} must be a non-empty, trimmed string of at most 128 characters`);
  return value;
}
function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be a valid timestamp`);
  return new Date(value).toISOString();
}
function count(value: unknown, name: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value as number;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new TypeError(`${name} is invalid`);
  return value as T;
}
