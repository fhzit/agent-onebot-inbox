import { notificationRetryDelayMs, type NotificationRetryOptions } from './notification-retry-policy.js';

export type NotificationRetryScheduleOptions = NotificationRetryOptions & {
  now?: Date;
  runAfter?: Date;
};

/**
 * Compute the next queue-eligible time for one failed attempt.
 * Returns null for permanent failures or exhausted attempt budgets. The queue's
 * existing runAfter is a lower bound; transient backoff is capped by maxDelayMs.
 */
export function scheduleNotificationRetry(
  attempt: number,
  error: unknown,
  options: NotificationRetryScheduleOptions = {},
): Date | null {
  const delay = notificationRetryDelayMs(attempt, error, options);
  if (delay === null) return null;
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid date');
  const proposed = now.getTime() + delay;
  const notBefore = options.runAfter?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (options.runAfter && !Number.isFinite(notBefore)) throw new Error('runAfter must be a valid date');
  return new Date(Math.max(proposed, notBefore));
}
