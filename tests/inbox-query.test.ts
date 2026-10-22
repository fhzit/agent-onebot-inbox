import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';

const store = new MessageStore();
for (const [id, account, sender, time, text, type] of [
  ['1','a','bob',1700000000,'Hello there','private'], ['2','b','alice',1700000100,'urgent task','group'], ['3','a','bob',1700000200,'hello again','group'],
] as const) {
 const m=normalizeEvent(account,'provider','fixture',{post_type:'message',message_type:type,self_id:'100',user_id:sender,group_id:'g',message_id:id,time,message:text})!;
 store.insert(m);
}

test('filtered query combines predicates and returns stable pagination metadata', () => {
 const result=store.query({account_id:'a', sender:'bob', keyword:'HELLO', offset:0, limit:1});
 assert.equal(result.total,2); assert.equal(result.messages.length,1); assert.equal(result.messages[0]?.external_message_id,'3');
 assert.equal(result.offset,0); assert.equal(result.limit,1); assert.equal(result.has_more,true);
});

test('query supports type priority at-me and inclusive time bounds', () => {
 const m=normalizeEvent('c','provider','fixture',{post_type:'message',message_type:'group',self_id:'100',user_id:'z',group_id:'g',message_id:'4',time:1700000300,message:'[CQ:at,qq=100] ping'})!;
 store.insert(m);
 const r=store.query({type:'group',at_me:true,since:new Date(1700000300*1000).toISOString(),until:new Date(1700000300*1000).toISOString()});
 assert.equal(r.total,1); assert.equal(r.messages[0]?.at_me,true);
});
