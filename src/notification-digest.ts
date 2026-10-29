export type DigestNotification = {
  id: string;
  event: string;
  accountId: string | null;
  messageId: string | null;
};

export type NotificationDigest = {
  accountId: string | null;
  count: number;
  notificationIds: string[];
  messageIds: string[];
};

/** Group notifications by account, preserving input order and limiting each digest size. */
export function buildNotificationDigests(
  notifications: readonly DigestNotification[],
  batchSize = 20,
): NotificationDigest[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const groups = new Map<string, { accountId: string | null; items: DigestNotification[] }>();
  for (const item of notifications) {
    if (item.event !== 'message.received') continue;
    const key = item.accountId ?? '';
    let group = groups.get(key);
    if (!group) { group = { accountId: item.accountId, items: [] }; groups.set(key, group); }
    group.items.push(item);
  }
  const digests: NotificationDigest[] = [];
  for (const { accountId, items } of groups.values()) {
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const chunk = items.slice(offset, offset + batchSize);
      digests.push({ accountId, count: chunk.length, notificationIds: chunk.map(item => item.id), messageIds: chunk.flatMap(item => item.messageId ? [item.messageId] : []) });
    }
  }
  return digests;
}
