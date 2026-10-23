import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

test('production startup rejects missing durable database configuration', async () => {
  const account = { id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, access_token: 'transport-secret', permission: 'readonly' as const };
  await assert.rejects(startServer({ host: '127.0.0.1', port: 0, apiToken: 'api-secret', maxMessageBytes: 100000, logMessageContent: false, accounts: [account] }, undefined, { rules: [], watchPeople: [] }, { requireDatabase: true }), /DATABASE_URL/);
});

test('PostgreSQL runtime requires encryption key for durable managed account tokens', async () => {
  const account = { id:'main', alias:'Main', self_id:'10001', provider:'napcat', enabled:true, access_token:'transport-secret', permission:'readonly' as const };
  await assert.rejects(startServer({host:'127.0.0.1',port:0,apiToken:'api-secret',maxMessageBytes:100000,logMessageContent:false,accounts:[account]},undefined,{rules:[],watchPeople:[]},{databaseUrl:'postgres://invalid',requireDatabase:true}),/ACCOUNT_ENCRYPTION_KEY/);
});
