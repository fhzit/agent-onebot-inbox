/** Invoke the configured notifier exactly once; retry ownership belongs to the queue worker. */
export async function deliverNotificationOnce<T>(notify: () => Promise<T>): Promise<T> {
  return notify();
}
