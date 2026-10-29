import { randomUUID } from 'node:crypto';

type QueryResult<T> = { rows: T[] };
type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>> };

export type NotificationQueueItem = {
  id: string;
  event: string;
  accountId: string | null;
  messageId: string | null;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  leaseToken: string | null;
};
export type FailedNotification = NotificationQueueItem & { lastError: string | null };
export type EnqueueNotification = { event: string; accountId?: string | null; messageId?: string | null; dedupeKey: string; maxAttempts?: number; runAfter?: Date };
export type ClaimedNotification = NotificationQueueItem & { status: 'processing'; leaseToken: string };

/** Durable reference-only queue. Message contents and destination credentials are deliberately not accepted. */
export class PostgresNotificationQueue {
  constructor(private readonly db: Queryable, private readonly makeLeaseToken: () => string = randomUUID) {}

  async enqueue(input: EnqueueNotification): Promise<NotificationQueueItem> {
    if (!input.event.trim() || !input.dedupeKey.trim()) throw new Error('event and dedupeKey are required');
    const maxAttempts = boundedAttempts(input.maxAttempts ?? 5);
    const result = await this.db.query<Row>(
      `INSERT INTO notification_queue(event, account_id, message_id, dedupe_key, max_attempts, run_after)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key
       RETURNING ${columns}`,
      [input.event, input.accountId ?? null, input.messageId ?? null, input.dedupeKey, maxAttempts, input.runAfter ?? new Date()],
    );
    return requiredRow(result.rows[0], 'Notification enqueue returned no row');
  }

  async claim(leaseSeconds = 60): Promise<ClaimedNotification | null> {
    const seconds = Number.isFinite(leaseSeconds) ? Math.max(1, Math.min(3600, Math.floor(leaseSeconds))) : 60;
    const token = this.makeLeaseToken();
    const result = await this.db.query<Row>(
      `WITH exhausted AS (
         UPDATE notification_queue SET status='failed', lease_token=NULL, lease_until=NULL, updated_at=now()
         WHERE status='processing' AND lease_until <= now() AND attempts >= max_attempts
         RETURNING id
       ), candidate AS (
         SELECT id FROM notification_queue
         WHERE attempts < max_attempts AND run_after <= now()
           AND (status = 'pending' OR (status = 'processing' AND lease_until <= now()))
         ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE notification_queue q SET status='processing', attempts=q.attempts+1,
         lease_token=$1, lease_until=now()+($2 * interval '1 second'), updated_at=now()
       FROM candidate c WHERE q.id=c.id RETURNING ${qualifiedColumns}`,
      [token, seconds],
    );
    const row = result.rows[0];
    return row ? { ...requiredRow(row, 'Invalid claimed notification'), status: 'processing', leaseToken: token } : null;
  }

  async listFailed(limit = 50): Promise<FailedNotification[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50;
    const result = await this.db.query<Row & { last_error: string | null }>(
      `SELECT ${columns}, last_error FROM notification_queue
       WHERE status = 'failed' ORDER BY updated_at DESC, id LIMIT $1`, [boundedLimit],
    );
    return result.rows.map((row) => ({ ...requiredRow(row, 'Invalid failed notification'), lastError: safeError(row.last_error) }));
  }

  /** Explicitly requeue a terminal failure. Resets the retry budget only after an admin action. */
  async retryFailed(id: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `UPDATE notification_queue SET status='pending', attempts=0, run_after=now(), last_error=NULL,
         lease_token=NULL, lease_until=NULL, updated_at=now()
       WHERE id=$1 AND status='failed' RETURNING id`, [id],
    );
    return result.rows.length === 1;
  }

  /** Extend an owned, still-live lease; expired leases cannot be resurrected. */
  async renew(id: string, leaseToken: string, leaseSeconds = 60): Promise<boolean> {
    const seconds = Number.isFinite(leaseSeconds) ? Math.max(1, Math.min(3600, Math.floor(leaseSeconds))) : 60;
    const result = await this.db.query<{ id: string }>(
      `UPDATE notification_queue SET lease_until=now()+($3 * interval '1 second'), updated_at=now()
       WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until > now() RETURNING id`,
      [id, leaseToken, seconds],
    );
    return result.rows.length === 1;
  }

  async complete(id: string, leaseToken: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `UPDATE notification_queue SET status='succeeded', lease_token=NULL, lease_until=NULL, last_error=NULL, updated_at=now()
       WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until > now() RETURNING id`, [id, leaseToken],
    );
    return result.rows.length === 1;
  }

  async retry(id: string, leaseToken: string, error?: string | null, runAfter?: Date): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `UPDATE notification_queue SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         run_after=CASE WHEN attempts >= max_attempts THEN now()
           ELSE COALESCE($3, now()+LEAST(interval '1 hour', interval '5 seconds' * power(2, LEAST(attempts-1, 10)))) END,
         lease_token=NULL, lease_until=NULL, last_error=$4, updated_at=now()
       WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until > now() RETURNING id`,
      [id, leaseToken, runAfter ?? null, safeError(error)],
    );
    return result.rows.length === 1;
  }
}

type Row = { id: string; event: string; account_id: string | null; message_id: string | null; status: NotificationQueueItem['status']; attempts: number; max_attempts: number; run_after: Date; lease_token: string | null };
const columns = 'id,event,account_id,message_id,status,attempts,max_attempts,run_after,lease_token';
const qualifiedColumns = 'q.id,q.event,q.account_id,q.message_id,q.status,q.attempts,q.max_attempts,q.run_after,q.lease_token';
function requiredRow(row: Row | undefined, error: string): NotificationQueueItem {
  if (!row) throw new Error(error);
  return { id: row.id, event: row.event, accountId: row.account_id, messageId: row.message_id, status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts, runAfter: row.run_after, leaseToken: row.lease_token };
}
function boundedAttempts(value: number): number {
  if (!Number.isInteger(value)) throw new Error('maxAttempts must be an integer');
  return Math.max(1, Math.min(20, value));
}
function safeError(error: string | null | undefined): string | null {
  if (!error) return null;
  const code = /^HTTP ([1-5]\d\d)$/.exec(error.trim());
  return code ? `HTTP ${code[1]}` : 'Notification delivery failed';
}
