import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AccountConfig } from '../config.js';
import type { NormalizedMessage, Segment } from '../normalize.js';
import type { OneBotGateway } from '../onebot-service.js';
import { uploadAttachment, type AttachmentUploadTarget, type AttachmentUploadResult } from './upload-adapter.js';
import { resolveAllowedFile } from './sandbox.js';

export type AttachmentUploadPermission = 'direct' | string;
export type UploadAndSendResult = { upload: AttachmentUploadResult; message: NormalizedMessage };

/** Explicit, single-shot upload then send. Caller owns durable request idempotency. */
export async function uploadAndSendAttachment(
  gateway: Pick<OneBotGateway, 'callApi' | 'sendMessage'>,
  account: AccountConfig,
  permission: AttachmentUploadPermission,
  target: AttachmentUploadTarget,
  inputPath: string,
  allowedRoots: readonly string[],
  maxBytes: number,
  requestId: string,
): Promise<UploadAndSendResult> {
  if (permission !== 'direct') throw new Error('Direct permission is required for attachment upload');
  if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('Explicit request ID is required');
  const file = await resolveAllowedFile(inputPath, allowedRoots, maxBytes);
  const digest = createHash('sha256').update(await readFile(file.realPath)).digest('hex');
  const upload = await uploadAttachment(gateway, account, target, file.realPath, allowedRoots, maxBytes);
  if (!upload || (upload.provider !== 'napcat' && upload.provider !== 'snowluma') || typeof upload.action !== 'string' || !upload.action || !upload.response || typeof upload.response !== 'object' || Array.isArray(upload.response) || (upload.response as Record<string, unknown>).status !== 'ok' || Number((upload.response as Record<string, unknown>).retcode) !== 0) throw new Error('Attachment upload returned an invalid action result');
  const data = (upload.response as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Attachment upload response omitted file data');
  const fileId = (data as Record<string, unknown>).file_id;
  if (typeof fileId !== 'string' || !fileId.trim()) throw new Error('Attachment upload response omitted file_id');
  const segment: Segment = { type: 'file', data: { file: fileId } };
  const message = await gateway.sendMessage(account, target.type, target.id, [segment], requestId);
  return { upload, message };
}
