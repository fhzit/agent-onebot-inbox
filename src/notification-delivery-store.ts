export type NotificationDeliveryOutcome = 'success' | 'failure';
export type NotificationDelivery = {
  event: string;
  accountId: string | null;
  messageId: string | null;
  outcome: NotificationDeliveryOutcome;
  httpStatus?: number | null;
  error?: string | null;
};
export type SavedNotificationDelivery = NotificationDelivery & { id: string; createdAt: Date };
type QueryResult<T> = { rows: T[] };
type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>> };

/** Stores a minimal delivery record. Never pass webhook bodies, URLs, or secrets here. */
export class PostgresNotificationDeliveryStore {
  constructor(private readonly db: Queryable) {}

  async record(delivery: NotificationDelivery): Promise<SavedNotificationDelivery> {
    const result = await this.db.query<{ id: string; event: string; account_id: string | null; message_id: string | null; outcome: NotificationDeliveryOutcome; http_status: number | null; error: string | null; created_at: Date }>(
      `INSERT INTO notification_deliveries(event, account_id, message_id, outcome, http_status, error)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id, event, account_id, message_id, outcome, http_status, error, created_at`,
      [delivery.event, delivery.accountId, delivery.messageId, delivery.outcome, delivery.httpStatus ?? null, safeError(delivery.error)],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Notification delivery insert returned no row');
    return { id: row.id, event: row.event, accountId: row.account_id, messageId: row.message_id, outcome: row.outcome, httpStatus: row.http_status, error: row.error, createdAt: row.created_at };
  }

  async list(limit = 50): Promise<SavedNotificationDelivery[]> {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50;
    const result = await this.db.query<{ id: string; event: string; account_id: string | null; message_id: string | null; outcome: NotificationDeliveryOutcome; http_status: number | null; error: string | null; created_at: Date }>(
      `SELECT id, event, account_id, message_id, outcome, http_status, error, created_at
       FROM notification_deliveries ORDER BY created_at DESC, id DESC LIMIT $1`, [bounded],
    );
    return result.rows.map(row => ({ id: row.id, event: row.event, accountId: row.account_id, messageId: row.message_id, outcome: row.outcome, httpStatus: row.http_status, error: row.error, createdAt: row.created_at }));
  }
}

function safeError(error: string | null | undefined): string | null {
  if (!error) return null;
  // Do not persist arbitrary exception text: retain only a short, generic HTTP status label.
  const status = /^HTTP ([1-5]\d\d)$/.exec(error.trim());
  return status ? `HTTP ${status[1]}` : 'Notification delivery failed';
}
