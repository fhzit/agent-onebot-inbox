import type { AccountConfig } from './config.js';
import type { OneBotEvent } from './normalize.js';

export type ContactSyncRequest =
  | { kind: 'friends' }
  | { kind: 'groups' }
  | { kind: 'members'; group_id: string };

export type ContactSyncCallback = (account: AccountConfig, request: ContactSyncRequest) => Promise<unknown>;

const MAX_ACCOUNT_ID_LENGTH = 128;
const MAX_GROUP_ID_LENGTH = 64;
const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);

function normalizeIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  const text = String(value);
  if (text.length === 0 || text.length > maxLength || !/^[0-9]+$/.test(text)) return null;
  const significant = text.replace(/^0+/, '') || '0';
  if (significant.length > MAX_SAFE_INTEGER_TEXT.length ||
      (significant.length === MAX_SAFE_INTEGER_TEXT.length && significant > MAX_SAFE_INTEGER_TEXT)) return null;
  return significant;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Map bounded OneBot v11 notice events to account-local snapshot refreshes. */
export function mapContactChangeEvent(event: unknown): ContactSyncRequest[] {
  if (!isRecord(event) || event.post_type !== 'notice' || typeof event.notice_type !== 'string') return [];
  const notice = event.notice_type;
  if (notice === 'friend_add' || notice === 'friend_recall') return [{ kind: 'friends' }];
  if (notice === 'group_increase' || notice === 'group_decrease') {
    const groupId = normalizeIdentifier(event.group_id, MAX_GROUP_ID_LENGTH);
    return groupId === null ? [] : [{ kind: 'groups' }, { kind: 'members', group_id: groupId }];
  }
  if (notice === 'group_admin' || notice === 'group_ban' || notice === 'group_card') {
    const groupId = normalizeIdentifier(event.group_id, MAX_GROUP_ID_LENGTH);
    return groupId === null ? [] : [{ kind: 'members', group_id: groupId }];
  }
  if (notice === 'group_name') return [{ kind: 'groups' }];
  return [];
}

/** Run only known refresh requests, pinned to an explicitly resolved account. */
export async function syncContactChangeEvent(
  account: AccountConfig,
  event: unknown,
  sync: ContactSyncCallback,
): Promise<number> {
  if (!isRecord(account) || typeof account.id !== 'string' || account.id.length === 0 || account.id.length > MAX_ACCOUNT_ID_LENGTH || typeof sync !== 'function') return 0;
  const requests = mapContactChangeEvent(event);
  for (const request of requests) await sync(account, request);
  return requests.length;
}
