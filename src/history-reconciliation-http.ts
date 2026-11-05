import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountConfig } from './config.js';
import type { HistoryKind } from './provider-history.js';
import type { HistoryReconciliationRequest } from './history-reconciliation-service.js';

export const HISTORY_RECONCILIATION_HTTP_PATH = /^\/api\/admin\/accounts\/([^/]+)\/history\/reconcile\/preview$/;
export const DEFAULT_HISTORY_RECONCILIATION_MAX_BODY_BYTES = 8_192;
export type HistoryReconciliationHttpOptions = {
  isAuthorized: (request: IncomingMessage) => boolean | Promise<boolean>;
  resolveAccount: (id: string, request: IncomingMessage) => Promise<AccountConfig | undefined> | AccountConfig | undefined;
  service: (request: HistoryReconciliationRequest) => Promise<unknown>;
  maxBodyBytes?: number;
};

/** Creates an independently-wirable raw Node HTTP handler; it has no server imports or persistence adapters. */
export function createHistoryReconciliationHttpHandler(options: HistoryReconciliationHttpOptions) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_HISTORY_RECONCILIATION_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 1_048_576) throw new RangeError('maxBodyBytes must be between 1 and 1048576');
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const match = HISTORY_RECONCILIATION_HTTP_PATH.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (req.method !== 'POST' || !match) return send(res, 404, { error: 'Not found' });
    try {
      if (!await options.isAuthorized(req)) return send(res, 401, { error: 'Unauthorized' });
      const encodedAccountId = match[1];
      if (encodedAccountId === undefined) return send(res, 400, { error: 'Invalid history reconciliation request' });
      const accountId = decodeURIComponent(encodedAccountId);
      if (!accountId.trim()) return send(res, 400, { error: 'Invalid history reconciliation request' });
      const body = await readJson(req, maxBodyBytes);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Invalid history reconciliation request' });
      const value = body as Record<string, unknown>;
      if ((value.kind !== 'private' && value.kind !== 'group') || (typeof value.targetId !== 'string' && typeof value.targetId !== 'number') ||
          (typeof value.targetId === 'string' ? !value.targetId.trim() : !Number.isSafeInteger(value.targetId)) || !Number.isSafeInteger(value.limit) || Number(value.limit) < 1)
        return send(res, 400, { error: 'Invalid history reconciliation request' });
      const account = await options.resolveAccount(accountId, req);
      if (!account) return send(res, 404, { error: 'Account not found' });
      const serviceRequest: HistoryReconciliationRequest = { account, accountId, kind: value.kind as HistoryKind, targetId: value.targetId, count: value.limit as number, ...(req.destroyed ? { signal: AbortSignal.abort() } : {}) };
      return send(res, 200, await options.service(serviceRequest));
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof RangeError && error.message === 'BODY_TOO_LARGE') return send(res, 413, { error: 'Request body too large' });
      if (error instanceof SyntaxError || error instanceof TypeError) return send(res, 400, { error: 'Invalid history reconciliation request' });
      send(res, 502, { error: 'History reconciliation failed' });
    }
  };
}
async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > max) throw new RangeError('BODY_TOO_LARGE'); chunks.push(bytes); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
}
