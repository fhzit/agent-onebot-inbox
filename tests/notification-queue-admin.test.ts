import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
import { PostgresNotificationQueue } from '../src/notification-queue.js';
const account = { id:'main', alias:'Main', self_id:'10001', provider:'napcat', enabled:true, access_token:'transport-secret', permission:'direct' as const };
test('failed notifications endpoint requires authentication', async () => {
 const runtime=await startServer({host:'127.0.0.1',port:0,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 try { const response=await fetch(`http://127.0.0.1:${runtime.address()!.port}/api/admin/notifications/failed`); assert.equal(response.status,401); }
 finally { await runtime.close(); }
});

test('failed notifications admin routes reject unauthenticated requests and report memory mode without details', async () => {
 const runtime=await startServer({host:'127.0.0.1',port:0,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 try {
  const base=`http://127.0.0.1:${runtime.address()!.port}`;
  const unauthorized=await fetch(`${base}/api/admin/notifications/failed?limit=0`);
  assert.equal(unauthorized.status,401);
  const list=await fetch(`${base}/api/admin/notifications/failed`,{headers:{authorization:'Bearer api-secret'}});
  assert.equal(list.status,503);
  assert.deepEqual(await list.json(),{error:{code:'QUEUE_UNAVAILABLE',message:'Durable notification queue requires database configuration',retryable:false}});
  const retry=await fetch(`${base}/api/admin/notifications/failed/id/retry`,{method:'POST'});
  assert.equal(retry.status,401);
  const unavailableRetry=await fetch(`${base}/api/admin/notifications/failed/id/retry`,{method:'POST',headers:{authorization:'Bearer api-secret'}});
  assert.equal(unavailableRetry.status,503);
  const retryResponse=JSON.stringify(await unavailableRetry.json());
  assert.match(retryResponse,/QUEUE_UNAVAILABLE/);
  assert.doesNotMatch(retryResponse,/stack|password|secret|error detail/i);
 } finally { await runtime.close(); }
});

test('failed-list limit validation precedes unavailable-queue response', async () => {
 const runtime=await startServer({host:'127.0.0.1',port:0,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 try {
  const base=`http://127.0.0.1:${runtime.address()!.port}/api/admin/notifications/failed`;
  for(const limit of ['0','101','1.5','NaN']) {
   const response=await fetch(`${base}?limit=${encodeURIComponent(limit)}`,{headers:{authorization:'Bearer api-secret'}});
   assert.equal(response.status,400,limit);
   const body=await response.json() as {error:{code:string;message:string}};
   assert.equal(body.error.code,'VALIDATION_ERROR');
   assert.match(body.error.message,/limit must be an integer/);
  }
 } finally { await runtime.close(); }
});

test('retryFailed resets all retry/lease/error state atomically and only transitions failed rows once', async () => {
 const calls:Array<{sql:string;values:unknown[]}> = [];
 let found=true;
 const queue=new PostgresNotificationQueue({async query(text:string,values:unknown[]=[]){calls.push({sql:text,values});return {rows:found?[{id:'row-1'}]:[]};}});
 assert.equal(await queue.retryFailed('row-1'),true);
 const sql=calls[0]!.sql;
 assert.match(sql,/UPDATE notification_queue SET status='pending'/);
 assert.match(sql,/attempts=0/);
 assert.match(sql,/run_after=now\(\)/);
 assert.match(sql,/last_error=NULL/);
 assert.match(sql,/lease_token=NULL/);
 assert.match(sql,/lease_until=NULL/);
 assert.match(sql,/WHERE id=\$1 AND status='failed' RETURNING id/);
 assert.deepEqual(calls[0]!.values,['row-1']);
 found=false;
 assert.equal(await queue.retryFailed('row-1'),false,'a repeated retry cannot transition an already requeued row');
});
