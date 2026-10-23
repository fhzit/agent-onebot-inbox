import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresPriorityStore } from '../src/priority-store.js';

test('Postgres priority store round trips rules and watched contacts', async () => {
 const rules=new Map<string,any>(),people=new Map<string,any>();
 const pool={query:async(sql:string,params:any[]=[])=>{
  if(sql.startsWith('SELECT id,enabled,account_scope,conditions,actions'))return {rows:[...rules.values()],rowCount:rules.size};
  if(sql.startsWith('SELECT id,qq_id,display_name'))return {rows:[...people.values()],rowCount:people.size};
  if(sql.startsWith('INSERT INTO priority_rules')){rules.set(params[0],{id:params[0],enabled:true,account_scope:JSON.parse(params[2]),order_index:params[3],conditions:JSON.parse(params[4]),actions:JSON.parse(params[5])});return {rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO watch_people')){people.set(params[0],{id:params[0],account_scope:JSON.parse(params[1]),qq_id:params[2],display_name:params[3],enabled:params[4],priority_boost:params[5]});return {rows:[],rowCount:1};}
  if(sql.startsWith('DELETE FROM priority_rules'))return {rows:[],rowCount:Number(rules.delete(params[0]))};
  if(sql.startsWith('DELETE FROM watch_people'))return {rows:[],rowCount:Number(people.delete(params[0]))};
  throw new Error('unexpected SQL');
 }};
 const store=new PostgresPriorityStore(pool as never);
 await store.putRule({id:'rule-1',keywords:['urgent'],weight:40,kind:'hard',priority:'P0',accountIds:['a']});
 await store.putWatchPerson({id:'person-1',userId:'123',displayName:'Alice',boost:25,enabled:true,accountIds:['a']});
 assert.deepEqual(await store.list(),{rules:[{id:'rule-1',keywords:['urgent'],weight:40,kind:'hard',priority:'P0',accountIds:['a'],conversationTypes:[],groupIds:[],senderIds:[]}],watchPeople:[{userId:'123',boost:25,accountIds:['a']}]});
 assert.equal(await store.deleteRule('rule-1'),true);assert.equal(await store.deleteWatchPerson('person-1'),true);assert.deepEqual(await store.list(),{rules:[],watchPeople:[]});
});
