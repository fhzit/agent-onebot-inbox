import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvent } from '../src/normalize.js';
import { MessageStore } from '../src/store.js';

test('context bounds are validated instead of silently coercing NaN', () => {
  const store = new MessageStore();
  const m = normalizeEvent('a','napcat','fixture',{post_type:'message',message_type:'private',self_id:'10',user_id:'20',message_id:1,time:1700000000,message:'x'})!;
  store.insert(m);
  assert.throws(() => store.context(m.id, Number.NaN, 0), /window/i);
  assert.throws(() => store.context(m.id, -1, 0), /window/i);
});
