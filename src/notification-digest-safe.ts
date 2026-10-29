export type SafeDigestNotification = {
  id: string;
  event: string;
  accountId: string | null;
  messageId: string | null;
};

export type SafeNotificationDigest = {
  accountId: string | null;
  count: number;
  notificationIds: string[];
  messageIds: string[];
};

/**
 * Group received-message notifications by exact account identity and split each
 * account into bounded, input-ordered digests. Map keys preserve null distinctly
 * from the empty-string account ID.
 */
export function buildSafeNotificationDigests(
  notifications: readonly SafeDigestNotification[],
  batchSize = 20,
): SafeNotificationDigest[] {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive safe integer');
  }

  const groups = new Map<string | null, SafeDigestNotification[]>();
  for (const notification of notifications) {
    if (notification.event !== 'message.received') continue;
    let group = groups.get(notification.accountId);
    if (group === undefined) {
      group = [];
      groups.set(notification.accountId, group);
    }
    group.push(notification);
  }

  const digests: SafeNotificationDigest[] = [];
  for (const [accountId, items] of groups) {
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const chunk = items.slice(offset, offset + batchSize);
      digests.push({
        accountId,
        count: chunk.length,
        notificationIds: chunk.map(item => item.id),
        messageIds: chunk.flatMap(item => item.messageId === null ? [] : [item.messageId]),
      });
    }
  }
  return digests;
}
