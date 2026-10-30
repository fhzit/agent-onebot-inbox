import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

export interface ReconciliationQueryClient {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<Pick<QueryResult<R>, 'rows'>>;
}
export interface ReconciliationPool {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<Pick<QueryResult<R>, 'rows'>>;
  connect(): Promise<PoolClient>;
}

export type PendingIdempotencyRecord = {
  accountId: string;
  requestId: string;
  messageType: 'private' | 'group';
  targetId: string;
  state: 'pending';
  createdAt: Date | string;
  updatedAt: Date | string;
};
export type AdjudicationOutcome = 'sent' | 'not-sent' | 'unresolved';
export type IdempotencyAdjudication = {
  id: string;
  accountId: string;
  requestId: string;
  outcome: AdjudicationOutcome;
  note: string;
  actor: string;
  createdAt: Date | string;
};

const MAX_NOTE_LENGTH = 1000;
const MAX_ACTOR_LENGTH = 200;
const MAX_LIST_LIMIT = 100;

function requiredText(value: string, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

/** Inspection and audit only; this store never sends or changes the outbound ledger state. */
export class PostgresIdempotencyReconciliationStorage {
  constructor(private readonly pool: ReconciliationPool) {}

  async listPending(accountId: string, limit = 50): Promise<PendingIdempotencyRecord[]> {
    requiredText(accountId, 'accountId', MAX_ACTOR_LENGTH);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new RangeError(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT account_id, client_request_id, message_type, target_id, state, created_at, updated_at
       FROM outbound_idempotency WHERE account_id=$1 AND state='pending'
       ORDER BY created_at, client_request_id LIMIT $2`, [accountId, limit]);
    return result.rows.map(row => ({ accountId: String(row.account_id), requestId: String(row.client_request_id), messageType: row.message_type as 'private' | 'group', targetId: String(row.target_id), state: 'pending', createdAt: row.created_at as Date | string, updatedAt: row.updated_at as Date | string }));
  }

  async adjudicate(input: { accountId: string; requestId: string; outcome: AdjudicationOutcome; note: string; actor: string }): Promise<IdempotencyAdjudication> {
    requiredText(input.accountId, 'accountId', MAX_ACTOR_LENGTH);
    requiredText(input.requestId, 'requestId', 500);
    requiredText(input.actor, 'actor', MAX_ACTOR_LENGTH);
    if (typeof input.note !== 'string' || input.note.length > MAX_NOTE_LENGTH) throw new TypeError(`note must be a string of at most ${MAX_NOTE_LENGTH} characters`);
    if (!['sent', 'not-sent', 'unresolved'].includes(input.outcome)) throw new TypeError('outcome must be sent, not-sent, or unresolved');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<Record<string, unknown>>(
        `SELECT account_id FROM outbound_idempotency WHERE account_id=$1 AND client_request_id=$2 AND state='pending' FOR UPDATE`,
        [input.accountId, input.requestId]);
      if (pending.rows.length !== 1) throw new Error('Pending idempotency record not found');
      const inserted = await client.query<Record<string, unknown>>(
        `INSERT INTO outbound_idempotency_adjudications(account_id,client_request_id,outcome,note,actor)
         VALUES($1,$2,$3,$4,$5) RETURNING id,account_id,client_request_id,outcome,note,actor,created_at`,
        [input.accountId, input.requestId, input.outcome, input.note, input.actor]);
      const row = inserted.rows[0];
      if (!row) throw new Error('Adjudication insert returned no record');
      await client.query('COMMIT');
      return { id: String(row.id), accountId: String(row.account_id), requestId: String(row.client_request_id), outcome: row.outcome as AdjudicationOutcome, note: String(row.note), actor: String(row.actor), createdAt: row.created_at as Date | string };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally { client.release(); }
  }

  async listAdjudications(accountId: string, requestId: string): Promise<IdempotencyAdjudication[]> {
    requiredText(accountId, 'accountId', MAX_ACTOR_LENGTH);
    requiredText(requestId, 'requestId', 500);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id,account_id,client_request_id,outcome,note,actor,created_at
       FROM outbound_idempotency_adjudications WHERE account_id=$1 AND client_request_id=$2 ORDER BY created_at,id`,
      [accountId, requestId]);
    return result.rows.map(row => ({ id: String(row.id), accountId: String(row.account_id), requestId: String(row.client_request_id), outcome: row.outcome as AdjudicationOutcome, note: String(row.note), actor: String(row.actor), createdAt: row.created_at as Date | string }));
  }
}
