import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { PostgresMessageStore, type SqlClient } from '../src/postgres-store.js';
import type { QueryResultRow } from 'pg';

test('PostgresMessageStore inserts and reads a normalized message through SQL', async () => {
 const queries: {text:string;values:unknown[]}[]=[];
 const db:SqlClient={async query<R extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]){queries.push({text,values});if(text.includes('INSERT INTO conversations'))return {rows:[{id:'main:private:22'}] as unknown as R[]};if(text.includes('INSERT INTO messages'))return {rows:[{id:'m-1',account_id:'main',direction:'incoming'}] as unknown as R[]};return {rows:[] as R[]};}};
 const store=new PostgresMessageStore(db);
 const message=normalizeEvent('main','napcat','fixture',{post_type:'message',message_type:'private',self_id:'10001',user_id:'22',message_id:77,time:1700000000,message:'persist me'})!;
 const inserted=await store.insert(message);
 assert.equal(inserted.inserted,true);
 assert.ok(queries.some(q=>q.text.includes('INSERT INTO messages')));
 assert.ok(queries.some(q=>q.text.includes('INSERT INTO inbox_states')));
 assert.equal(queries.some(q=>q.text.includes('inbox_messages')),false);
});

test('PostgresMessageStore message lookup reads normalized values and durable inbox state', async () => {
 const db:SqlClient={async query<R extends QueryResultRow=QueryResultRow>(text:string){if(text.includes('SELECT m.id'))return {rows:[{id:'m-1',account_id:'main',direction:'incoming',external_id:'main:private:22',conversation_id:'main:private:22',conversation_type:'private',type:'private',plain_text:'persist me',raw_message:[{type:'text',data:{text:'persist me'}}],sent_at:new Date('2026-01-01T00:00:00Z'),received_at:new Date('2026-01-01T00:00:01Z'),sender_id:'22',event_fingerprint:'f',seen_by_agent:true,processed:false,dismissed:false}] as unknown as R[]};if(text.includes('SELECT m.direction'))return {rows:[{direction:'incoming',seen_by_agent:true,processed:false,dismissed:false}] as unknown as R[]};return {rows:[] as R[]};}};
 const store=new PostgresMessageStore(db);
 const row=await store.get('m-1');
 const state=await store.state('m-1');
 assert.equal(row?.plain_text,'persist me');
 assert.equal(row?.account_id,'main');
 assert.equal(state?.unread,false);
 assert.equal(state?.seen_by_agent,true);
});
