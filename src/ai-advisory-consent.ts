/** Consent domain contract for enabling AI-generated advisory metadata per account.
 * This module is intentionally storage-agnostic: its in-memory implementation is
 * process-local and is not a durable audit log. No provider message content is accepted.
 */
export type AiAdvisoryConsentGrant = Readonly<{
  accountId: string;
  enabled: true;
  grantedAt: string;
  /** Operator/user identity or audit reference; never provider message content. */
  grantedBy: string;
  disclosureVersion: string;
  /** Monotonic per-account revision, suitable for audit ordering. */
  revision: number;
}>;

export type AiAdvisoryConsentRevocation = Readonly<{
  accountId: string;
  enabled: false;
  revokedAt: string;
  revokedBy: string;
  disclosureVersion: string;
  revision: number;
}>;

export type AiAdvisoryConsentState = AiAdvisoryConsentGrant | AiAdvisoryConsentRevocation;
export type AiAdvisoryConsentCommand = Readonly<{ accountId: string; actor: string; disclosureVersion?: string }>;

/** Adapter contract; implementations must scope reads and writes by exact accountId. */
export interface AiAdvisoryConsentRepository {
  get(accountId: string): Promise<AiAdvisoryConsentState | undefined>;
  /** Atomic per-account transition. Production adapters must guarantee durable ordering. */
  update(accountId: string, build: (previous: AiAdvisoryConsentState | undefined) => AiAdvisoryConsentState): Promise<AiAdvisoryConsentState>;
}

export interface AiAdvisoryConsentService {
  enable(command: AiAdvisoryConsentCommand): Promise<AiAdvisoryConsentGrant>;
  revoke(command: AiAdvisoryConsentCommand): Promise<AiAdvisoryConsentRevocation>;
  query(accountId: string): Promise<AiAdvisoryConsentState | undefined>;
}

export class ConsentValidationError extends TypeError {}

export function createAiAdvisoryConsentService(
  repository: AiAdvisoryConsentRepository,
  now: () => Date = () => new Date(),
): AiAdvisoryConsentService {
  return {
    async enable(command) {
      const { accountId, actor } = validateCommand(command);
      const build = (previous: AiAdvisoryConsentState | undefined): AiAdvisoryConsentGrant => Object.freeze({
        accountId, enabled: true, grantedAt: timestamp(now), grantedBy: actor,
        disclosureVersion: validateText(command.disclosureVersion ?? 'v1', 'disclosureVersion'),
        revision: (previous?.revision ?? 0) + 1,
      });
      if (!repository.update) throw new TypeError('consent repository must provide atomic update');
      const result = await repository.update(accountId, build);
      if (result.enabled !== true) throw new TypeError('consent repository returned invalid grant state');
      return Object.freeze({ ...result });
    },
    async revoke(command) {
      const { accountId, actor } = validateCommand(command);
      const build = (previous: AiAdvisoryConsentState | undefined): AiAdvisoryConsentRevocation => Object.freeze({
        accountId, enabled: false, revokedAt: timestamp(now), revokedBy: actor,
        disclosureVersion: previous?.disclosureVersion ?? 'v1',
        revision: (previous?.revision ?? 0) + 1,
      });
      if (!repository.update) throw new TypeError('consent repository must provide atomic update');
      const result = await repository.update(accountId, build);
      if (result.enabled !== false) throw new TypeError('consent repository returned invalid revocation state');
      return Object.freeze({ ...result });
    },
    async query(accountId) {
      const state = await repository.get(validateAccount(accountId));
      return state ? Object.freeze({ ...state }) : undefined;
    },
  };
}

export class InMemoryAiAdvisoryConsentRepository implements AiAdvisoryConsentRepository {
  private readonly states = new Map<string, AiAdvisoryConsentState>();
  private readonly locks = new Map<string, Promise<void>>();
  async get(accountId: string): Promise<AiAdvisoryConsentState | undefined> {
    const prior = this.locks.get(accountId);
    if (prior) await prior;
    const state = this.states.get(accountId);
    return state ? { ...state } : undefined;
  }
  async put(state: AiAdvisoryConsentState): Promise<void> {
    const prior = this.locks.get(state.accountId);
    if (prior) await prior;
    this.states.set(state.accountId, Object.freeze({ ...state }));
  }
  async update(accountId: string, build: (previous: AiAdvisoryConsentState | undefined) => AiAdvisoryConsentState): Promise<AiAdvisoryConsentState> {
    const prior = this.locks.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(accountId, tail);
    await prior;
    try {
      const previous = this.states.get(accountId);
      const next = Object.freeze({ ...build(previous && { ...previous }) });
      this.states.set(accountId, next);
      return { ...next };
    } finally {
      release();
      if (this.locks.get(accountId) === tail) this.locks.delete(accountId);
    }
  }
}

function validateCommand(command: AiAdvisoryConsentCommand): { accountId: string; actor: string } {
  if (!command || typeof command !== 'object') throw new ConsentValidationError('command is required');
  return { accountId: validateAccount(command.accountId), actor: validateText(command.actor, 'actor') };
}
function validateAccount(accountId: string): string { return validateText(accountId, 'accountId'); }
function validateText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim() || value.length > 128) {
    throw new ConsentValidationError(`${name} must be a non-empty, unpadded string of at most 128 characters`);
  }
  return value;
}
function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ConsentValidationError('clock must return a valid Date');
  return value.toISOString();
}
