import { createHmac } from 'node:crypto';

export type AgentNotification = {
  event: string;
  account: string;
  message_id: string | null;
  priority: string;
  sender: string;
  conversation: string;
  preview: string;
  reason: string;
};

export type AgentNotifier = { notify(event: AgentNotification): Promise<void> };
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HermesWebhookOptions = {
  url: string;
  secret: string;
  timeoutMs: number;
  fetch?: FetchLike;
};

/** Sends compact, signed notifications to a Hermes generic webhook V2 route. */
export class HermesWebhookNotifier implements AgentNotifier {
  private readonly fetcher: FetchLike;

  constructor(private readonly options: HermesWebhookOptions) {
    if (!options.url) throw new Error('Webhook URL is required');
    if (!options.secret) throw new Error('Webhook secret is required');
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Webhook timeoutMs must be positive');
    this.fetcher = options.fetch ?? fetch;
  }

  async notify(event: AgentNotification): Promise<void> {
    const body = JSON.stringify({
      event: event.event,
      account: event.account,
      message_id: event.message_id,
      priority: event.priority,
      sender: event.sender,
      conversation: event.conversation,
      preview: event.preview,
      reason: event.reason,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', this.options.secret).update(`${timestamp}.${body}`).digest('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetcher(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature-V2': signature,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Hermes webhook returned HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
