import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { WebSocket } from 'ws';

test('authenticated send API uploads an allowlisted local file then sends it to explicit target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aoi-upload-api-'));
  const file = path.join(root, 'report.pdf');
  await writeFile(file, 'fixture');
  const oldRoots = process.env.ATTACHMENT_ALLOWED_ROOTS;
  process.env.ATTACHMENT_ALLOWED_ROOTS = root;
  const port = 29100 + Math.floor(Math.random() * 300);
  const runtime = await startServer({ host: '127.0.0.1', port, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false,
    accounts: [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'direct' }] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws/main`, { headers: { authorization: 'Bearer transport-secret', 'x-self-id': '10001' } });
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const actions: Array<{action:string;params:Record<string,unknown>;echo:string}> = [];
    ws.on('message', raw => { const req = JSON.parse(raw.toString()) as {action:string;params:Record<string,unknown>;echo:string}; actions.push(req); const data = req.action === 'upload_private_file' ? {file_id:'uploaded-42'} : req.action === 'send_private_msg' ? {message_id:789} : {}; ws.send(JSON.stringify({status:'ok',retcode:0,data,echo:req.echo})); });
    const payload = {account_id:'main',client_request_id:'upload-api-1',target_id:'20002',message_type:'private',message:'',attachment_path:file};
    const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/api/messages/send`, {method:'POST',headers:{authorization:'Bearer api-secret','content-type':'application/json'},body:JSON.stringify(body)});
    const response = await post(payload);
    assert.equal(response.status,200);
    const first = await response.json() as {status:string;message:unknown};
    assert.equal(first.status,'sent');
    assert.deepEqual(actions.map(x=>x.action),['upload_private_file','send_private_msg']);
    assert.equal(actions[0]!.params.user_id,'20002');
    assert.deepEqual(actions[1]!.params.message,[{type:'file',data:{file:'uploaded-42'}}]);
    const retry = await post(payload);
    assert.equal(retry.status,200);
    const duplicate = await retry.json() as {status:string;message:unknown};
    assert.equal(duplicate.status,'duplicate');
    assert.deepEqual(duplicate.message,first.message);
    assert.deepEqual(actions.map(x=>x.action),['upload_private_file','send_private_msg']);
    const changedTarget = await post({...payload,target_id:'20003'});
    assert.equal(changedTarget.status,409);
    assert.equal(((await changedTarget.json()) as {error:{code:string}}).error.code,'IDEMPOTENCY_CONFLICT');
    const changedFile = path.join(root,'other.pdf');
    await writeFile(changedFile,'different fixture');
    const changedPayload = await post({...payload,attachment_path:changedFile});
    assert.equal(changedPayload.status,409);
    assert.equal(((await changedPayload.json()) as {error:{code:string}}).error.code,'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(actions.map(x=>x.action),['upload_private_file','send_private_msg']);
  } finally { ws.close(); await runtime.close(); await rm(root,{recursive:true,force:true}); if(oldRoots===undefined) delete process.env.ATTACHMENT_ALLOWED_ROOTS; else process.env.ATTACHMENT_ALLOWED_ROOTS=oldRoots; }
});
