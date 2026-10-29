import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContactSyncService } from '../src/contact-sync.js';

test('member pagination is stable, group-scoped, and uses signed cursors', async () => {
  const store: any = { get: async () => ({ friends: [], groups: [], members: [
    { group_id: 'g1', members: [{ user_id: '3' }, { user_id: '1' }, { user_id: '2' }] },
    { group_id: 'g2', members: [{ user_id: 'x' }] },
  ] }) };
  const service = new ContactSyncService({} as any, {} as any, store, 'secret');
  const first = await service.pageMembers('acct', 'g1', null, 2);
  assert.deepEqual(first.items.map(m => m.user_id), ['1', '2']);
  assert.ok(first.next_cursor);
  const last = await service.pageMembers('acct', 'g1', first.next_cursor, 2);
  assert.deepEqual(last.items.map(m => m.user_id), ['3']);
  assert.equal(last.next_cursor, null);
  await assert.rejects(() => service.pageMembers('acct', 'g2', first.next_cursor, 2), /Invalid or expired cursor/);
});
