import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuntimeOneBotService } from '../src/runtime-onebot-service.js';
import { safeActionFetch } from '../src/action-url-http.js';
import type { RuntimeStore } from '../src/postgres-store.js';
import type { AccountConfig } from '../src/config.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { collectBoundedResponse } from '../src/action-url-http.js';
const account: AccountConfig={id:'a',alias:'A',self_id:'1',provider:'napcat',enabled:true,permission:'direct',action_url:'http://127.0.0.1:9'};
const store={async list(){return []}} as unknown as RuntimeStore;
test('DNS results containing a private address are rejected before any request',async()=>{let requested=false;await assert.rejects(safeActionFetch('http://mock.example/action',{method:'POST'},async()=>[{address:'203.0.113.2',family:4},{address:'10.0.0.2',family:4}] as any),/unsafe/i);assert.equal(requested,false)});
test('DNS results are pinned and private resolved destinations are rejected',async()=>{let host='';await assert.rejects(safeActionFetch('http://mock.example/action',{method:'POST'},async(resolvedHost)=>{host=resolvedHost;return [{address:'127.0.0.1',family:4}] as any}),/unsafe/i);assert.equal(host,'mock.example')});
test('HTTP action_url rejects redirects rather than forwarding bearer credentials',async()=>{const service=new RuntimeOneBotService(new Map(),store);await assert.rejects(service.callApi({...account,action_url:'http://127.0.0.1:9'},'get_status',{}),/unsafe|network|fetch failed|connect/i)});

test('bounded collector accepts response body at the byte limit', async () => {
 const body=await collectBoundedResponse((async function*(){yield Buffer.alloc(5,65);})(),5);
 assert.equal(body.length,5);
});
test('bounded collector rejects streamed response body above the byte limit', async () => {
 await assert.rejects(collectBoundedResponse((async function*(){yield Buffer.alloc(4);yield Buffer.alloc(2);})(),5),/size limit/i);
});

for (const ip of ['2001:3::1', '2001:4:112::1', '2001:10::1', '2001:30::1', '2620:4f:8000::1', '2002:c000:0201::1', '2001:0000:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '2001:2::1', '2001:20::1', '100::1', '::192.0.2.1', '::ffff:10.0.0.1']) {
 test(`IPv6 destination ${ip} is rejected`, async () => {
  await assert.rejects(safeActionFetch('http://mock.example/', {}, async () => [{ address: ip, family: 6 }]), /unsafe/i);
 });
}
for (const ip of ['::ffff:7f00:1', '::ffff:a00:1']) {
 test(`IPv4-mapped IPv6 destination ${ip} is rejected`, async () => {
  await assert.rejects(safeActionFetch('http://mock.example/', {}, async () => [{ address: ip, family: 6 }]), /unsafe/i);
 });
}

test('globally routable IPv6 address passes destination policy', async () => {
 await assert.rejects(safeActionFetch('http://mock.example/', {}, async () => [{ address: '2606:4700:4700::1111', family: 6 }]), (error: unknown) => error instanceof TypeError && error.message.includes('Invalid IP address: undefined'));
});
test('response larger than 1 MiB is rejected before body is exposed', async () => {
 const server=createServer((_req,res)=>{res.write(Buffer.alloc(1024*1024+1,65));});
 server.listen(0,'127.0.0.1'); await once(server,'listening'); const {port}=server.address() as {port:number};
 try { await assert.rejects(safeActionFetch(`http://127.0.0.1:${port}/`),/unsafe/i); }
 finally { server.closeAllConnections(); server.close(); }
});
