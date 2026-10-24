import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startServer} from '../src/server.js';
import type {AppConfig} from '../src/config.js';
import {Pool} from 'pg';
const config=(port:number):AppConfig=>({host:'127.0.0.1',port,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,adminBasePath:'/admin',accounts:[]});
test('persistent audit API reads ordered rows and audits authenticated message status writes',async()=>{
 const statements:{text:string;values:unknown[]}[]=[];
 const fakePool={async query(text:string,values:unknown[]=[]){statements.push({text,values});if(text.includes('FROM schema_migrations'))return{rows:[{ok:1}],rowCount:1};if(text.includes('SELECT id,actor,action'))return{rows:[{id:'audit-1',actor:'admin',action:'message.process',result:'success'}],rowCount:1};return{rows:[],rowCount:1};},async connect(){return{query:async(text:string,values:unknown[]=[])=>(statements.push({text,values}),{rows:[],rowCount:1}),release(){}};},async end(){}};
 const original=Pool.prototype.query, originalConnect=Pool.prototype.connect, originalEnd=Pool.prototype.end;
 Pool.prototype.query=function(text:string,values?:unknown[]){return fakePool.query(text,values) as never};Pool.prototype.connect=function(){return fakePool.connect() as never};Pool.prototype.end=function(){return fakePool.end() as never};
 const port=32000+Math.floor(Math.random()*1000);let runtime:Awaited<ReturnType<typeof startServer>>|undefined;
 try{runtime=await startServer(config(port),undefined,{rules:[],watchPeople:[]},{databaseUrl:'postgres://unit-test',accountEncryptionKey:Buffer.alloc(32,9).toString('base64')});const base=`http://127.0.0.1:${runtime.address()!.port}`,headers={authorization:'Bearer api-secret','content-type':'application/json'};const audit=await fetch(`${base}/api/admin/audit?limit=10`,{headers});assert.equal(audit.status,200);assert.equal((await audit.json() as {events:{id:string}[]}).events[0]?.id,'audit-1');const processed=await fetch(`${base}/api/messages/mark_processed`,{method:'POST',headers,body:JSON.stringify({message_id:'missing-message'})});assert.equal(processed.status,404);assert.ok(statements.some(x=>x.text.includes('INSERT INTO audit_logs')));const inserted=statements.find(x=>x.text.includes('INSERT INTO audit_logs'))!;assert.equal(inserted.values[1],'message.process');assert.equal(JSON.stringify(inserted.values).includes('api-secret'),false);}finally{if(runtime)await runtime.close();Pool.prototype.query=original;Pool.prototype.connect=originalConnect;Pool.prototype.end=originalEnd;}
});
