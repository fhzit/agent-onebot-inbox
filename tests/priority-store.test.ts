import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryPriorityStore } from '../src/priority-store.js';
import { scorePriority } from '../src/priority.js';

test('priority settings persist through storage and affect scoring with enabled rules only', async () => {
  const store = new MemoryPriorityStore();
  await store.putRule({ id:'urgent', kind:'weighted', weight:60, keywords:['urgent'], accountIds:['a'] });
  await store.putWatchPerson({ id:'vip', userId:'42', displayName:'VIP', enabled:true, boost:15, accountIds:['a'] });
  const config = await store.list();
  assert.equal(config.rules.length,1);
  assert.equal(config.watchPeople.length,1);
  const score = scorePriority({ accountId:'a', conversationType:'private', senderId:'42', text:'urgent!', atMe:false, atAll:false, baseScore:0 },config);
  assert.equal(score.priority,'P1');
  assert.deepEqual(score.matchedRules,['urgent']);
  assert.equal(await store.deleteRule('urgent'),true);
  assert.equal((await store.list()).rules.length,0);
  assert.equal(await store.deleteWatchPerson('vip'),true);
});
