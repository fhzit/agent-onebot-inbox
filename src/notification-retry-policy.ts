export type NotificationFailure = { retryable: boolean; category: 'transient' | 'permanent'; retryAfterMs: number | null };

export type NotificationRetryOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
};

/** Classify webhook failures and compute a bounded zero-based exponential delay. */
export function classifyNotificationFailure(error: unknown): NotificationFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = /(?:returned )?HTTP ([1-5]\d\d)\b/i.exec(message);
  if (!match) return { retryable: true, category: 'transient', retryAfterMs: null };
  const status = Number(match[1]);
  const retryable = status === 408 || status === 429 || status >= 500;
  return { retryable, category: retryable ? 'transient' : 'permanent', retryAfterMs: null };
}

/** Return null when the attempt budget is exhausted or the failure is permanent. */
export function notificationRetryDelayMs(
  attempt: number,
  error: unknown,
  options: NotificationRetryOptions = {},
): number | null {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 5_000;
  const maxDelayMs = options.maxDelayMs ?? 3_600_000;
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new Error('baseDelayMs must be non-negative');
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) throw new Error('maxDelayMs must be non-negative');
  if (attempt >= maxAttempts || !classifyNotificationFailure(error).retryable) return null;
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempt - 1, 52));
}
