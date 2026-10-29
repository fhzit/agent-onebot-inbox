import type { AccountConfig } from '../config.js';
import type { OneBotGateway } from '../onebot-service.js';
import { resolveAllowedFile } from './sandbox.js';
import { selectAttachmentUploadAction } from '../attachment-upload-policy.js';

export type AttachmentUploadTarget =
  | { type: 'group'; id: string; folder?: string }
  | { type: 'private'; id: string };

export type AttachmentUploadResult = { provider: 'napcat' | 'snowluma'; action: string; response: unknown };

/**
 * Uploads a local file using an explicitly declared provider action.
 * Caller must enforce direct permission before invoking. Account and target are
 * explicit; paths are resolved through the configured allowlist and size limit.
 * Upload support is currently enabled only for NapCat; providers without a
 * verified upload action fail closed. NapCat's upload actions require the
 * provider/version to accept a local absolute path in `file`.
 * Streamed-upload support is version-dependent; no fallback is attempted.
 */
export async function uploadAttachment(
  gateway: Pick<OneBotGateway, 'callApi'>,
  account: AccountConfig,
  target: AttachmentUploadTarget,
  inputPath: string,
  allowedRoots: readonly string[],
  maxBytes: number,
): Promise<AttachmentUploadResult> {
  if (account.provider !== 'napcat' && account.provider !== 'snowluma') {
    throw new Error(`Unsupported attachment upload provider: ${account.provider}`);
  }
  if (!account.id || !target.id || !target.id.trim()) throw new Error('Explicit account and target are required');
  const action = selectAttachmentUploadAction(account.provider, target.type);
  const file = await resolveAllowedFile(inputPath, allowedRoots, maxBytes);
  const params: Record<string, unknown> = target.type === 'group'
    ? { group_id: target.id, file: file.realPath, name: file.basename }
    : { user_id: target.id, file: file.realPath, name: file.basename };
  if (target.type === 'group' && target.folder !== undefined) params.folder = target.folder;
  const response = await gateway.callApi(account, action, params);
  const result = response !== null && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : {};
  if (result.status !== 'ok' || Number(result.retcode) !== 0) throw new Error(`${account.provider} ${action} action failed`);
  return { provider: account.provider, action, response };
}
