type QueryResult<T> = { rows: T[] };
type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>> };

export type HistoryReconciliationAudit = {
  mode: 'read_only_local_audit';
  providerHistoryAvailable: false;
  incomingMessages: number;
  queuedNotifications: number;
  missingNotificationRows: number;
  scope: 'database_local_state_only';
};

/**
 * Read-only local consistency report. This does not query provider history or
 * recover messages absent from local persistence.
 */
export class PostgresHistoryReconciliationAudit {
  constructor(private readonly db: Queryable) {}

  async report(): Promise<HistoryReconciliationAudit> {
    const result = await this.db.query<{
      incoming_messages: number | string;
      queued_notifications: number | string;
      missing_notification_rows: number | string;
    }>(`SELECT
         (SELECT count(*) FROM messages WHERE direction = 'incoming') AS incoming_messages,
         (SELECT count(*) FROM notification_queue WHERE event = 'message.received') AS queued_notifications,
         (SELECT count(*) FROM messages m
          WHERE m.direction = 'incoming'
            AND NOT EXISTS (
              SELECT 1 FROM notification_queue q
              WHERE q.message_id = m.id AND q.event = 'message.received'
            )) AS missing_notification_rows`);
    const row = result.rows[0];
    if (!row) throw new Error('History audit query returned no result');
    const count = (value: number | string): number => {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('History audit returned an invalid count');
      return parsed;
    };
    return {
      mode: 'read_only_local_audit',
      providerHistoryAvailable: false,
      incomingMessages: count(row.incoming_messages),
      queuedNotifications: count(row.queued_notifications),
      missingNotificationRows: count(row.missing_notification_rows),
      scope: 'database_local_state_only',
    };
  }
}
