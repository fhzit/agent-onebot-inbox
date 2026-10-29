import type { AccountConfig } from '../config.js';
import type { NormalizedMessage, Segment } from '../normalize.js';
import type { OneBotGateway } from '../onebot-service.js';
import { uploadAttachment, type AttachmentUploadTarget, type AttachmentUploadResult } from './upload-adapter.js';

export type AttachmentUploadPermission = 'direct' | string;
export type UploadAndSendResult = { upload: AttachmentUploadResult; message: NormalizedMessage };

/** Explicit, single-shot upload then send. This helper is not runtime/API wired. */
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
  const upload = await uploadAttachment(gateway, account, target, inputPath, allowedRoots, maxBytes);
  if (!upload || (upload.provider !== 'napcat' && upload.provider !== 'snowluma') ||
      typeof upload.action !== 'string' || !upload.action ||
      !upload.response || typeof upload.response !== 'object' || Array.isArray(upload.response) ||
      (upload.response as Record<string, unknown>).status !== 'ok' ||
      Number((upload.response as Record<string, unknown>).retcode) !== 0) {
    throw new Error('Attachment upload returned an invalid action result');
  }
  const responseData = (upload.response as Record<string, unknown>).data;
  if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData)) {
    throw new Error('Attachment upload response omitted file data');
  }
  const uploadedFile = (responseData as Record<string, unknown>).file_id;
  if (typeof uploadedFile !== 'string' || !uploadedFile.trim()) {
    throw new Error('Attachment upload response omitted file_id');
  }
  const segment: Segment = { type: 'file', data: { file: uploadedFile } };
  const message = await gateway.sendMessage(account, target.type, target.id, [segment], requestId);
  return { upload, message };
}
