import type { ClaimedNotification, PostgresNotificationQueue } from './notification-queue.js';
import { buildNotificationDigests, type NotificationDigest } from './notification-digest.js';

/** Claims ready message notifications and delivers bounded per-account digest payloads. */
export class NotificationDigestWorker {
  constructor(
    private readonly queue: Pick<PostgresNotificationQueue, 'claim' | 'complete' | 'retry'> & Partial<Pick<PostgresNotificationQueue, 'renew'>>,
    private readonly deliver: (digest: NotificationDigest) => Promise<boolean>,
    private readonly batchSize = 20,
    private readonly leaseSeconds = 60,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  }

  async flush(maxItems = 100): Promise<number> {
    const items: ClaimedNotification[] = [];
    const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(100, Math.floor(maxItems))) : 100;
    for (let i = 0; i < limit; i++) {
      const item = await this.queue.claim();
      if (!item) break;
      if (item.event === 'message.received') items.push(item);
      else {
        // One malformed/unsupported row must not strand later claims in this batch.
        try { await this.queue.retry(item.id, item.leaseToken, 'Unsupported digest event'); } catch { /* best effort transition */ }
      }
    }
    const digests = buildNotificationDigests(items, this.batchSize);
    let delivered = 0;
    for (const digest of digests) {
      const group = items.filter(item => digest.notificationIds.includes(item.id));
      let success = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let leaseLost = false;
      let renewalInFlight: Promise<void> | undefined;
      const renewGroup = async () => {
        await Promise.all(group.map(async item => {
          try {
            if (!await this.queue.renew!(item.id, item.leaseToken, this.leaseSeconds)) leaseLost = true;
          } catch { leaseLost = true; }
        }));
      };
      if (this.queue.renew) {
        // Establish/verify ownership before beginning potentially slow external delivery.
        await renewGroup();
        if (!leaseLost) {
          heartbeat = setInterval(() => {
            if (leaseLost || renewalInFlight) return;
            renewalInFlight = renewGroup().finally(() => { renewalInFlight = undefined; });
          }, Math.max(1, Math.floor(this.leaseSeconds * 1000 / 3)));
          heartbeat.unref?.();
        }
      }
      try { if (!leaseLost) success = await this.deliver(digest); } catch { /* retry leased rows below */ }
      finally {
        if (heartbeat) clearInterval(heartbeat);
        if (renewalInFlight) await renewalInFlight;
      }
      if (leaseLost) success = false;
      for (const item of group) {
        try {
          if (success) {
            // A stale/expired lease means this worker no longer owns the row.
            if (await this.queue.complete(item.id, item.leaseToken)) delivered++;
          } else {
            await this.queue.retry(item.id, item.leaseToken, 'Digest delivery failed');
          }
        } catch {
          // Queue transition errors must not turn uncertain delivery into success.
        }
      }
    }
    return delivered;
  }
}
