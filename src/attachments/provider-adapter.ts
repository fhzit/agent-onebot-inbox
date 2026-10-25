import type { AccountConfig } from '../config.js';
import type { OneBotGateway } from '../onebot-service.js';
import type { ProviderFileRetriever } from './retrieval.js';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

/** Adapt OneBot get_file to the path-based sandbox retriever. This does not fetch URLs. */
export function createOneBotFileRetriever(gateway: Pick<OneBotGateway, 'callApi'>, account: AccountConfig): ProviderFileRetriever {
  return async (providerFileId: string): Promise<string> => {
    if (typeof providerFileId !== 'string' || providerFileId.trim().length === 0) throw new Error('Provider file ID is required');
    const response = record(await gateway.callApi(account, 'get_file', { file_id: providerFileId }));
    if (response.status !== 'ok' || Number(response.retcode) !== 0) throw new Error('OneBot get_file action failed');
    const data = record(response.data);
    if (typeof data.file !== 'string' || data.file.trim().length === 0 || !isAbsolutePath(data.file)) {
      throw new Error('OneBot get_file response did not contain an absolute local file path');
    }
    return data.file;
  };
}
function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}
