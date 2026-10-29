import type { QueryResultRow } from 'pg';
import type { IdempotencyQueryClient } from './outbound-idempotency-store.js';

type PendingRow = QueryResultRow & {
  account_id: string;
  client_request_id: string;
  message_type: 'private' | 'group';
  state: 'pending';
  created_at: Date | string;
  updated_at: Date | string;
};

export type PendingClaimDiagnostic = {
  accountId: string;
  requestId: string;
  messageType: 'private' | 'group';
  state: 'pending';
  createdAt: string;
  updatedAt: string;
};

export type PendingInspectionOptions = { accountId?: string; limit?: number };

/** Read-only report of pending claims. Deliberately never selects payload or response. */
export async function inspectPendingIdempotency(
  db: IdempotencyQueryClient,
  options: PendingInspectionOptions = {},
): Promise<{ count: number; claims: PendingClaimDiagnostic[] }> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000');
  const rows = options.accountId
    ? await db.query<PendingRow>(
      `SELECT account_id,client_request_id,message_type,state,created_at,updated_at
       FROM outbound_idempotency WHERE state='pending' AND account_id=$1
       ORDER BY created_at ASC,account_id ASC,client_request_id ASC LIMIT $2`,
      [options.accountId, limit],
    )
    : await db.query<PendingRow>(
      `SELECT account_id,client_request_id,message_type,state,created_at,updated_at
       FROM outbound_idempotency WHERE state='pending'
       ORDER BY created_at ASC,account_id ASC,client_request_id ASC LIMIT $1`,
      [limit],
    );
  const claims = rows.rows.map(row => ({
    accountId: row.account_id,
    requestId: row.client_request_id,
    messageType: row.message_type,
    state: 'pending' as const,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  return { count: claims.length, claims };
}

/** Standalone operator entrypoint; wire the application's configured pool here. */
export async function runIdempotencyInspectCli(
  db: IdempotencyQueryClient,
  args: string[],
  print: (text: string) => void = console.log,
): Promise<void> {
  let accountId: string | undefined;
  let limit: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag !== '--account' && flag !== '--limit') throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--account') accountId = value;
    else if (flag === '--limit') {
      limit = Number(value);
      if (!Number.isInteger(limit)) throw new Error('--limit must be an integer');
    } else throw new Error(`Unknown option: ${flag}`);
  }
  const report = await inspectPendingIdempotency(db, { ...(accountId ? { accountId } : {}), ...(limit === undefined ? {} : { limit }) });
  print(JSON.stringify(report, null, 2));
}
