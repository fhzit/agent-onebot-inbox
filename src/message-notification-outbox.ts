type QueryResult<T> = { rows: T[] };
type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>> };

export type ReconcileMessageNotifications = { limit?: number; maxAttempts?: number };

/**
 * Bounded recovery helper for incoming messages whose queue write was missed.
 * It does not make message persistence atomic; the server runs it periodically when PostgreSQL is configured.
 */
export class PostgresMessageNotificationOutbox {
  constructor(private readonly db: Queryable) {}

  async reconcile(options: ReconcileMessageNotifications = {}): Promise<string[]> {
    const attempts = options.maxAttempts ?? 5;
    if (!Number.isInteger(attempts)) throw new Error('maxAttempts must be an integer');
    const maxAttempts = Math.max(1, Math.min(20, attempts));
    const requestedLimit = options.limit ?? 50;
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
    const result = await this.db.query<{ message_id: string }>(
      `WITH missing AS (
         SELECT m.id, m.account_id
         FROM messages m
         WHERE m.direction='incoming'
           AND NOT EXISTS (
             SELECT 1 FROM notification_queue q
             WHERE q.message_id=m.id AND q.event=$1
           )
         ORDER BY m.received_at, m.id
         FOR UPDATE OF m SKIP LOCKED
         LIMIT $3
       )
       INSERT INTO notification_queue(event, account_id, message_id, dedupe_key, max_attempts)
       SELECT $1, missing.account_id, missing.id, 'message.received:' || missing.id, $2
       FROM missing
       ON CONFLICT(dedupe_key) DO NOTHING
       RETURNING message_id`,
      ['message.received', maxAttempts, limit],
    );
    return result.rows.map(row => row.message_id);
  }
}
