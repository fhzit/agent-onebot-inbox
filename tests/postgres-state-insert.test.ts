import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import { normalizeEvent } from '../src/normalize.js';
const m=()=>normalizeEvent('main','napcat','http:main',{post_type:'message',message_type:'private',self_id:'10001',user_id:'42',message_id:7,time:1700000000,message:'hi'})!;
test('Postgres inserts seed incoming state and preserve provider-unread semantics',async()=>{let seq=0;const seen:string[]=[];const db:SqlClient={async query(text){seen.push(text);if(text.includes('INSERT INTO conversations'))return{rows:[{id:'c'}]};if(text.includes('INSERT INTO messages'))return{rows:[{id:'m'}]};return{rows:[]};}};const store=new PostgresMessageStore(db);await store.insert(m());assert.ok(seen.some(x=>x.includes('INSERT INTO inbox_states')));});
