import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

const account = { id:'main', alias:'Main', self_id:'10001', provider:'napcat', enabled:true, access_token:'transport-secret', permission:'readonly' as const };
const token = 'api-secret';
const headers = { authorization:`Bearer ${token}`, 'content-type':'application/json' };

test('account management is authenticated and supports create, update, redacted reads and delete',async()=>{
 const port=31500+Math.floor(Math.random()*400);const runtime=await startServer({host:'127.0.0.1',port,apiToken:token,maxMessageBytes:100000,logMessageContent:false,accounts:[account]});const base=`http://127.0.0.1:${port}`;
 try{
  assert.equal((await fetch(`${base}/api/admin/accounts`)).status,401);
  const invalid=await fetch(`${base}/api/admin/accounts`,{method:'POST',headers,body:JSON.stringify({alias:'Bad',self_id:'22',provider:'unknown',access_token:'dont-log-me'})});assert.equal(invalid.status,400);
  const created=await fetch(`${base}/api/admin/accounts`,{method:'POST',headers,body:JSON.stringify({id:'secondary',alias:'Secondary',self_id:'20002',provider:'napcat',access_token:'new-private-token',permission:'readonly'})});assert.equal(created.status,201);const result=await created.json() as {account:{id:string;access_token_configured:boolean}};assert.equal(result.account.access_token_configured,true);assert.equal(JSON.stringify(result).includes('new-private-token'),false);
  const list=await fetch(`${base}/api/admin/accounts`,{headers:{authorization:`Bearer ${token}`}});const listed=await list.json() as {accounts:{id:string;access_token_configured:boolean}[]};assert.equal(listed.accounts.length,2);assert.equal(listed.accounts.find(a=>a.id==='secondary')?.access_token_configured,true);
  const updated=await fetch(`${base}/api/admin/accounts/secondary`,{method:'PUT',headers,body:JSON.stringify({alias:'Secondary updated',self_id:'20002',provider:'snowluma',enabled:false,permission:'confirm'})});assert.equal(updated.status,200);
  assert.equal((await fetch(`${base}/api/accounts`,{headers:{authorization:`Bearer ${token}`}})).status,200);
  assert.equal((await fetch(`${base}/api/admin/accounts/secondary`,{method:'DELETE',headers})).status,200);
 }finally{await runtime.close();}
});

test('priority rule/watch-person management is authenticated, persistent for runtime, and changes ingress scoring',async()=>{
 const port=31000+Math.floor(Math.random()*500);
 const runtime=await startServer({host:'127.0.0.1',port,apiToken:token,maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 const base=`http://127.0.0.1:${port}`;
 try{
  assert.equal((await fetch(`${base}/api/admin/priority`)).status,401);
  const invalid=await fetch(`${base}/api/admin/priority/rules`,{method:'POST',headers,body:JSON.stringify({kind:'weighted',weight:500,keywords:['urgent']})});
  assert.equal(invalid.status,400);
  const created=await fetch(`${base}/api/admin/priority/rules`,{method:'POST',headers,body:JSON.stringify({kind:'weighted',weight:60,keywords:['urgent'],accountIds:['main']})});
  assert.equal(created.status,201);
  const rule=await created.json() as {rule:{id:string}};
  const watch=await fetch(`${base}/api/admin/priority/watch-people`,{method:'POST',headers,body:JSON.stringify({userId:'42',displayName:'VIP',boost:15,accountIds:['main']})});
  assert.equal(watch.status,201);
  const watchData=await watch.json() as {watchPerson:{id:string}};
  const settings=await fetch(`${base}/api/admin/priority`,{headers:{authorization:`Bearer ${token}`}});
  const config=await settings.json() as {rules:{id:string}[];watchPeople:{userId:string}[]};
  assert.equal(config.rules.length,1); assert.equal(config.watchPeople.length,1);
  const event={post_type:'message',message_type:'private',self_id:10001,user_id:42,message_id:123,time:1700000000,message:'urgent please'};
  const ingest=await fetch(`${base}/onebot/v11/events/main`,{method:'POST',headers:{authorization:'Bearer transport-secret','content-type':'application/json'},body:JSON.stringify(event)});
  assert.equal(ingest.status,200);
  const inbox=await fetch(`${base}/api/messages?account_id=main`,{headers:{authorization:`Bearer ${token}`}});
  const messages=await inbox.json() as {messages:{priority:string;priority_score:number}[]};
  assert.equal(messages.messages[0]?.priority,'P0');
  assert.equal(messages.messages[0]?.priority_score,90);
  assert.equal((await fetch(`${base}/api/admin/priority/rules/${encodeURIComponent(rule.rule.id)}`,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(`${base}/api/admin/priority/watch-people/${encodeURIComponent(watchData.watchPerson.id)}`,{method:'DELETE',headers})).status,200);
 }finally{await runtime.close();}
});
