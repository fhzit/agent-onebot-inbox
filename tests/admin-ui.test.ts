import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { startServer } from '../src/server.js';

const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' as const };

test('admin embedded script parses successfully', async () => {
  const { adminPage } = await import('../src/admin-page.js');
  const script = adminPage.slice(adminPage.indexOf('<script>') + 8, adminPage.indexOf('</script>'));
  const { writeFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aoi-admin-js-'));
  const file = path.join(tempDir, 'inline.js');
  try {
    await writeFile(file, script);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally { await rm(tempDir, { recursive: true, force: true }); }
});

test('admin audit endpoint rejects unauthenticated, invalid pagination, and reports unavailable persistent storage',async()=>{
 const port=30000+Math.floor(Math.random()*500); const runtime=await startServer({host:'127.0.0.1',port,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 try {
  const denied=await fetch(`http://127.0.0.1:${port}/api/admin/audit`);
  assert.equal(denied.status,401);
  const invalid=await fetch(`http://127.0.0.1:${port}/api/admin/audit?limit=101`,{headers:{authorization:'Bearer api-secret'}});
  assert.equal(invalid.status,400);
  const response=await fetch(`http://127.0.0.1:${port}/api/admin/audit?limit=10`,{headers:{authorization:'Bearer api-secret'}});
  assert.equal(response.status,503);
  assert.equal((await response.json() as {error:{code:string}}).error.code,'AUDIT_UNAVAILABLE');
 } finally {await runtime.close();}
});
test('serves a local admin UI without embedding secrets or external assets', async () => {
  const port = 25000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const html = await response.text();
    assert.match(html, /Agent OneBot Inbox/);
    assert.doesNotMatch(html, /api-secret|transport-secret/);
    assert.match(html, /mark_processed/);
    assert.match(html, /dismiss/);
    assert.match(html, /View details/);
    assert.match(html, /message-detail/);
    assert.match(html, /segments/);
    assert.match(html, /textContent/);
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
    assert.ok(script.length > 1000);
    const { writeFile } = await import('node:fs/promises');
    const { spawnSync } = await import('node:child_process');
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aoi-admin-ui-'));
    const scriptPath = path.join(tempDir, 'inline.js');
    try {
      await writeFile(scriptPath, script);
      const checked = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
      assert.equal(checked.status, 0, checked.stderr);
    } finally { await rm(tempDir, { recursive: true, force: true }); }
    assert.match(html, /auditRows/);
    assert.match(html, /loadAudit/);
    assert.match(html, /api\/admin\/audit/);
    assert.match(html, /data-tab="settings"/);
    assert.match(html, /settingsDatabase/);
    assert.match(html, /settingsAccounts/);
    assert.match(html, /API 地址/);
    assert.match(html, /settingsRefresh/);
  } finally { await runtime.close(); }
});

test('admin page serves valid HTML at configured base path', async()=>{
 const port=29000+Math.floor(Math.random()*1000);
 const runtime=await startServer({host:'127.0.0.1',port,adminBasePath:'/console',apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 try {assert.equal((await fetch(`http://127.0.0.1:${port}/console`)).status,200);assert.equal((await fetch(`http://127.0.0.1:${port}/admin`)).status,404);} finally {await runtime.close();}
});

test('summary returns connected account details and runtime counters', async () => {
  const port=27000+Math.floor(Math.random()*1000);
  const runtime=await startServer({host:'127.0.0.1',port,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
  try {
    const denied=await fetch(`http://127.0.0.1:${port}/api/summary`);
    assert.equal(denied.status,401);
    const response=await fetch(`http://127.0.0.1:${port}/api/summary`,{headers:{authorization:'Bearer api-secret'}});
    const data=await response.json() as {count:number;unread:number;high_priority:number;accounts:{id:string;connected:boolean;access_token?:string}[];counters:{ingested:number};uptime_seconds:number};
    assert.equal(response.status,200);
    assert.deepEqual([data.count,data.unread,data.high_priority],[0,0,0]);
    assert.deepEqual(data.accounts.map(a=>[a.id,a.connected,a.access_token]),[['main',false,undefined]]);
    assert.deepEqual(data.counters,{ingested:0,duplicates:0,sends_succeeded:0,sends_failed:0});
    assert.ok(data.uptime_seconds>=0);
  } finally {await runtime.close();}
});

test('authenticated message list includes persisted Agent inbox state and qq_read remains false', async () => {
 const port=28000+Math.floor(Math.random()*1000);
 const runtime=await startServer({host:'127.0.0.1',port,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]});
 try {
  await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`,{method:'POST',headers:{authorization:'Bearer transport-secret','content-type':'application/json'},body:JSON.stringify({post_type:'message',message_type:'private',self_id:10001,user_id:42,message_id:99,time:1700000000,message:'state-test'})});
  const auth={authorization:'Bearer api-secret'};
  const first=await fetch(`http://127.0.0.1:${port}/api/messages`,{headers:auth});
  const body=await first.json() as {messages:{id:string;state:{unread:boolean;processed:boolean;dismissed:boolean;qq_read:boolean}}[]};
  assert.equal(body.messages[0]?.state.unread,true);
  assert.equal(body.messages[0]?.state.qq_read,false);
  const mark=await fetch(`http://127.0.0.1:${port}/api/messages/mark_processed`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({message_id:body.messages[0]!.id})});
  assert.equal(mark.status,200);
  const reread=await (await fetch(`http://127.0.0.1:${port}/api/messages?processed=true`,{headers:auth})).json() as typeof body;
  assert.equal(reread.messages[0]?.state.processed,true);
  assert.equal(reread.messages[0]?.state.qq_read,false);
 } finally {await runtime.close();}
});


test('inbox query type can filter inbox state', async () => {
  const port = 26000 + Math.floor(Math.random() * 1000);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] });
  try {
    const auth = { authorization: 'Bearer api-secret' };
    const event = (id:number) => ({post_type:'message',message_type:'private',self_id:10001,user_id:42,message_id:id,time:1700000000,message:`hello ${id}`});
    for (const id of [61,62,63]) await fetch(`http://127.0.0.1:${port}/onebot/v11/events/main`, {method:'POST',headers:{...auth,'content-type':'application/json',authorization:'Bearer transport-secret'},body:JSON.stringify(event(id))});
    const {messages}=await (await fetch(`http://127.0.0.1:${port}/api/messages`,{headers:auth})).json() as {messages:{id:string}[]};
    await fetch(`http://127.0.0.1:${port}/api/messages/mark_processed`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({message_id:messages[0]!.id})});
    await fetch(`http://127.0.0.1:${port}/api/messages/dismiss`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({message_id:messages[1]!.id})});
    const unread=await (await fetch(`http://127.0.0.1:${port}/api/messages?unread=true`,{headers:auth})).json() as {messages:{id:string}[];total:number};
    assert.equal(unread.total,1);
    const processed=await (await fetch(`http://127.0.0.1:${port}/api/messages?processed=true`,{headers:auth})).json() as {total:number};
    assert.equal(processed.total,1);
    const dismissed=await (await fetch(`http://127.0.0.1:${port}/api/messages?dismissed=true`,{headers:auth})).json() as {total:number};
    assert.equal(dismissed.total,1);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/messages?unread=true&processed=true`,{headers:auth})).status,400);
    assert.equal(runtime.store.list('main').length,3);
  } finally { await runtime.close(); }
});
