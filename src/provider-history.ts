import type { AccountConfig } from './config.js';

export type HistoryKind = 'private' | 'group';
export type ProviderHistoryPage = { messages: unknown[] };
export type HistoryApi = {
  callApi(account: AccountConfig, action: string, params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
};

export type ProviderHistoryRequest = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export const MAX_PROVIDER_HISTORY_COUNT = 200;
export const DEFAULT_PROVIDER_HISTORY_TIMEOUT_MS = 15_000;

/** Fetch one bounded page using only history actions documented for the provider. */
export async function fetchProviderHistoryPage(
  api: HistoryApi,
  account: AccountConfig,
  kind: HistoryKind,
  targetId: string | number,
  count: number,
  request: ProviderHistoryRequest = {},
): Promise<ProviderHistoryPage> {
  const provider = account.provider.trim().toLowerCase();
  if (provider !== 'napcat' && provider !== 'snowluma') {
    throw new Error(`History is unsupported for provider: ${provider}`);
  }
  if (typeof targetId !== 'string' && typeof targetId !== 'number') throw new Error('Invalid history target ID');
  if ((typeof targetId === 'string' && !targetId.trim()) || (typeof targetId === 'number' && !Number.isSafeInteger(targetId))) {
    throw new Error('Invalid history target ID');
  }
  if (kind !== 'private' && kind !== 'group') throw new Error('Invalid history kind');
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('History count must be a positive safe integer');
  const timeoutMs = request.timeoutMs ?? DEFAULT_PROVIDER_HISTORY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('History timeout must be a positive safe integer');
  if (request.signal?.aborted) throw request.signal.reason ?? new Error('History request aborted');
  const boundedCount = Math.min(count, MAX_PROVIDER_HISTORY_COUNT);
  const action = kind === 'private' ? 'get_friend_msg_history' : 'get_group_msg_history';
  const idKey = kind === 'private' ? 'user_id' : 'group_id';
  const params: Record<string, unknown> = { [idKey]: targetId, count: boundedCount };
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Provider history request timed out')), timeoutMs);
  try {
    const response = await Promise.race([
      api.callApi(account, action, params, { signal: controller.signal }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('History request aborted')), { once: true })),
    ]);
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error('History request aborted');
    const result = response;
    if (!result || typeof result !== 'object') throw new Error('Malformed history response');
    const envelope = result as Record<string, unknown>;
    if (envelope.status !== 'ok' || envelope.retcode !== 0) throw new Error('Provider history request failed');
    const data = envelope.data;
    if (!data || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).messages)) {
      throw new Error('Malformed history response');
    }
    return { messages: (data as { messages: unknown[] }).messages.slice(0, boundedCount) };
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', abortFromCaller);
  }
}
