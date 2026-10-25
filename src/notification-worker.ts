import type { ClaimedNotification, PostgresNotificationQueue } from './notification-queue.js';

/** Polls durable references; lease fencing makes duplicate workers safe. */
export class NotificationWorker {
  private stopping = false;
  private loop?: Promise<void>;
  constructor(private readonly queue: PostgresNotificationQueue, private readonly deliver: (item: ClaimedNotification) => Promise<boolean>, private readonly pollMs = 1000) {}
  start(): void { if (!this.loop) this.loop = this.run(); }
  async stop(): Promise<void> { this.stopping = true; await this.loop; }
  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const item = await this.queue.claim();
        if (!item) { await new Promise(resolve => setTimeout(resolve, this.pollMs)); continue; }
        try { if (await this.deliver(item)) await this.queue.complete(item.id, item.leaseToken); else await this.queue.retry(item.id, item.leaseToken, 'delivery failed'); }
        catch (error) { await this.queue.retry(item.id, item.leaseToken, error instanceof Error ? error.message : 'delivery failed'); }
      } catch { if (!this.stopping) await new Promise(resolve => setTimeout(resolve, this.pollMs)); }
    }
  }
}
