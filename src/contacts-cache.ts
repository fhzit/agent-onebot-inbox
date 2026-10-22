import { resolveContact, type Contact, type ContactResolution } from './contact-resolver.js';

export type Friend = { user_id: string | number; nickname?: string | null; remark?: string | null };
export type Group = { group_id: string | number; group_name?: string | null };
export type GroupMember = { user_id: string | number; nickname?: string | null; card?: string | null; role?: string | null };
const id = (value: string | number) => String(value);

/** In-memory snapshot cache, partitioned by account. Imports replace that snapshot. */
export class ContactsCache {
  private readonly friends = new Map<string, Map<string, Friend>>();
  private readonly groups = new Map<string, Map<string, Group>>();
  private readonly members = new Map<string, Map<string, Map<string, GroupMember>>>();

  replaceFriends(accountId: string, friends: readonly Friend[]): void {
    this.friends.set(accountId, new Map(friends.map(friend => [id(friend.user_id), { ...friend, user_id: id(friend.user_id) }])));
  }
  replaceGroups(accountId: string, groups: readonly Group[]): void {
    this.groups.set(accountId, new Map(groups.map(group => [id(group.group_id), { ...group, group_id: id(group.group_id) }])));
  }
  replaceGroupMembers(accountId: string, groupId: string | number, members: readonly GroupMember[]): void {
    let byGroup = this.members.get(accountId);
    if (!byGroup) this.members.set(accountId, byGroup = new Map());
    byGroup.set(id(groupId), new Map(members.map(member => [id(member.user_id), { ...member, user_id: id(member.user_id) }])));
  }
  getFriend(accountId: string, userId: string | number): Friend | undefined { return this.friends.get(accountId)?.get(id(userId)); }
  getGroup(accountId: string, groupId: string | number): Group | undefined { return this.groups.get(accountId)?.get(id(groupId)); }
  getGroupMember(accountId: string, groupId: string | number, userId: string | number): GroupMember | undefined {
    return this.members.get(accountId)?.get(id(groupId))?.get(id(userId));
  }
  getContacts(accountId: string): Contact[] {
    const contacts: Contact[] = [];
    for (const friend of this.friends.get(accountId)?.values() ?? []) contacts.push({ account_id: accountId, qq_id: id(friend.user_id), ...(friend.nickname !== undefined ? { nickname: friend.nickname } : {}), ...(friend.remark !== undefined ? { remark: friend.remark } : {}) });
    for (const [groupId, members] of this.members.get(accountId) ?? []) for (const member of members.values()) contacts.push({ account_id: accountId, qq_id: id(member.user_id), ...(member.nickname !== undefined ? { nickname: member.nickname } : {}), ...(member.card !== undefined ? { card: member.card } : {}), group_id: groupId });
    return contacts;
  }
  resolve(accountId: string, query: string): ContactResolution { return resolveContact(this.getContacts(accountId), accountId, query); }
}
