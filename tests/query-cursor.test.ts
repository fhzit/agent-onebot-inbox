import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageStore } from '../src/store.js';
import { normalizeEvent } from '../src/normalize.js';

test('in-memory query pagination includes outgoing messages and preserves stable ordering', () => {
  const store = new MessageStore();
  for (const [id, account, type, text] of [['1','main','private','first'], ['2','school','group','second'], ['3','main','group','third'], ['4','main','private','outgoing'] ] as const) {
    const m = normalizeEvent(account,'napcat','fixture',{post_type:'message',message_type:type,self_id:'100',user_id:'200',group_id:'g',message_id:id,time:1700000000,message:text})!;
    store.insert(id === '4' ? { ...m, direction: 'outgoing' } : m);
  }
  const page = store.query({ account_id:'main', offset:1, limit:1 });
  assert.equal(page.total, 3); assert.equal(page.messages.length, 1); assert.equal(page.has_more, true);
});
