import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export interface IdempotencyQueryClient {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<Pick<QueryResult<R>, 'rows'>>;
}
export interface IdempotencyPool extends IdempotencyQueryClient {
  connect(): Promise<PoolClient>;
}

export type OutboundIdempotencyRequest = {
  accountId: string;
  requestId: string;
  messageType: 'private' | 'group';
  targetId: string;
  payload: unknown;
};
export type OutboundIdempotencyRecord = OutboundIdempotencyRequest & {
  state: 'pending' | 'complete';
  response: unknown | null;
};

function canonical(value: unknown): string { return JSON.stringify(value); }

/** Durable request ledger. Claiming is atomic across processes via the database unique key. */
export class PostgresOutboundIdempotencyStore {
  constructor(private readonly pool: IdempotencyPool | Pool) {}

  async claim(request: OutboundIdempotencyRequest): Promise<{ created: boolean; record: OutboundIdempotencyRecord }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<Record<string, unknown>>(
        `INSERT INTO outbound_idempotency(account_id,client_request_id,message_type,target_id,payload,state)
         VALUES($1,$2,$3,$4,$5::jsonb,'pending') ON CONFLICT(account_id,client_request_id) DO NOTHING
         RETURNING account_id,client_request_id,message_type,target_id,payload,state,response`,
        [request.accountId, request.requestId, request.messageType, request.targetId, canonical(request.payload)]
      );
      let row = inserted.rows[0];
      const created = Boolean(row);
      if (!row) {
        const existing = await client.query<Record<string, unknown>>(
          `SELECT account_id,client_request_id,message_type,target_id,payload,state,response
           FROM outbound_idempotency WHERE account_id=$1 AND client_request_id=$2 FOR UPDATE`,
          [request.accountId, request.requestId]
        );
        row = existing.rows[0];
        if (!row) throw new Error('Idempotency record disappeared during claim');
        if (row.message_type !== request.messageType || row.target_id !== request.targetId || canonical(row.payload) !== canonical(request.payload)) {
          throw Object.assign(new Error('client_request_id was already used for a different send'), { code: 'IDEMPOTENCY_CONFLICT' });
        }
      }
      await client.query('COMMIT');
      return { created, record: { accountId: String(row.account_id), requestId: String(row.client_request_id), messageType: row.message_type as 'private' | 'group', targetId: String(row.target_id), payload: row.payload, state: row.state as 'pending' | 'complete', response: row.response ?? null } };
    } catch (error) {
      // A failed COMMIT may have succeeded on the server; rollback is best-effort and
      // cannot establish the transaction outcome. Preserve the original error.
      try { await client.query('ROLLBACK'); } catch { /* outcome remains uncertain */ }
      throw error;
    } finally { client.release(); }
  }

  async complete(accountId: string, requestId: string, response: unknown): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE outbound_idempotency SET state='complete',response=$3::jsonb,updated_at=now()
         WHERE account_id=$1 AND client_request_id=$2 AND state='pending'`,
        [accountId, requestId, canonical(response)]
      );
      if (result.rowCount == null) throw new Error('Database did not report idempotency completion row count');
      if (result.rowCount === 0) {
        const existing = await client.query<Record<string, unknown>>(
          `SELECT state,response FROM outbound_idempotency WHERE account_id=$1 AND client_request_id=$2`,
          [accountId, requestId]
        );
        const row = existing.rows[0];
        if (row?.state === 'complete' && canonical(row.response) === canonical(response)) return;
        throw new Error(row ? 'Idempotency record is not pending or response differs' : 'Idempotency record not found');
      }
      if (result.rowCount !== 1) throw new Error(`Expected to complete one idempotency record; updated ${result.rowCount}`);
    } finally { client.release(); }
  }
}
