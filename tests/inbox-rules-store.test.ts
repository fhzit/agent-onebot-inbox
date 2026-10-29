import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryInboxRulesStore, PostgresInboxRulesStore } from '../src/inbox-rules-store.js';

test('memory inbox rules store returns copies and replaces atomically', async () => {
 const store = new MemoryInboxRulesStore();
 const rules = [{ id: 'x', keywords: ['urgent'], action: 'mark_processed' as const }];
 await store.put(rules); const result = await store.get(); result[0]!.keywords![0] = 'mutated';
 assert.equal((await store.get())[0]!.keywords![0], 'urgent');
 await store.put([]); assert.deepEqual(await store.get(), []);
});
test('postgres inbox rules store uses app_settings JSON persistence', async () => {
 let value: unknown; const pool = { query: async (sql: string, params?: unknown[]) => {
  if (sql.startsWith('INSERT')) value = JSON.parse(String(params?.[1]));
  return { rows: value === undefined ? [] : [{ value }] };
 } };
 const store = new PostgresInboxRulesStore(pool as never);
 await store.put([{ id: 'r', action: 'dismiss' }]);
 assert.deepEqual(await store.get(), [{ id: 'r', action: 'dismiss' }]);
});
