import type { OneBotEvent } from './normalize.js';

export type ContactSyncRequest =
  | { kind: 'friends' }
  | { kind: 'groups' }
  | { kind: 'members'; group_id: string };

/** Map OneBot v11 notice events to safe full-snapshot refreshes. */
export function mapContactChangeEvent(event: OneBotEvent): ContactSyncRequest[] {
  if (event.post_type !== 'notice') return [];
  const notice = String(event.notice_type ?? '');
  if (notice === 'friend_add' || notice === 'friend_recall') return [{ kind: 'friends' }];
  if (notice === 'group_increase' || notice === 'group_decrease') {
    const groupId = event.group_id;
    if (groupId === undefined || groupId === null || String(groupId) === '') return [];
    return [
      { kind: 'groups' },
      { kind: 'members', group_id: String(groupId) },
    ];
  }
  if (notice === 'group_admin' || notice === 'group_ban' || notice === 'group_card') {
    const groupId = event.group_id;
    if (groupId === undefined || groupId === null || String(groupId) === '') return [];
    return [{ kind: 'members', group_id: String(groupId) }];
  }
  if (notice === 'group_name') return [{ kind: 'groups' }];
  return [];
}
