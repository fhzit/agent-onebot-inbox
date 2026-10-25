import { timingSafeEqual, createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { retrieveAttachment, type ProviderFileRetriever } from './retrieval.js';

export type AttachmentRouteAccount = { permission: string; retrieve: ProviderFileRetriever };
export type AttachmentRouteOptions = { apiToken: string; allowedRoots: readonly string[]; maxBytes: number; resolveAccount: (accountId: string) => AttachmentRouteAccount | undefined | Promise<AttachmentRouteAccount | undefined> };
const digest = (value: string) => createHmac('sha256', 'attachment-route').update(value).digest();
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(digest(supplied), digest(token));
}
function disposition(filename: string): string {
  const safe = filename.replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7e]/g, '_').slice(0, 180) || 'attachment';
  return `attachment; filename="${safe}"`;
}
function fail(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify({ error: { code: status === 401 ? 'AUTHENTICATION_ERROR' : status === 403 ? 'PERMISSION_DENIED' : status === 404 ? 'NOT_FOUND' : 'ATTACHMENT_ERROR', message: status === 401 ? 'Unauthorized' : status === 403 ? 'Direct attachment permission required' : status === 404 ? 'Attachment not found' : 'Attachment retrieval failed', retryable: false } }));
}
/** Isolated handler factory; mounting and account lookup remain the server's responsibility. */
export function createAttachmentRouteHandler(options: AttachmentRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const match = (req.url ?? '').split('?')[0]!.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
    if (req.method !== 'GET' || !match) return false;
    if (!authorized(req, options.apiToken)) { fail(res, 401); return true; }
    let accountId: string, fileId: string;
    try { accountId = decodeURIComponent(match[1]!); fileId = decodeURIComponent(match[2]!); } catch { fail(res, 404); return true; }
    if (!accountId || !fileId || /[\\/]/.test(fileId)) { fail(res, 404); return true; }
    const account = await options.resolveAccount(accountId);
    if (!account) { fail(res, 404); return true; }
    if (account.permission !== 'direct') { fail(res, 403); return true; }
    try {
      const file = await retrieveAttachment(fileId, account.retrieve, options.allowedRoots, options.maxBytes);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(file.size), 'content-disposition': disposition(path.basename(file.filename)), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
      res.end(file.bytes); return true;
    } catch { fail(res, 404); return true; }
  };
}
