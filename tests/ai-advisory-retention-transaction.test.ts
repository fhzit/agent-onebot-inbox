import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAiAdvisoryRetentionBatch, type AiAdvisoryRetentionTransaction } from '../src/ai-advisory-retention-transaction.js';

const records = [
  { accountId: 'acct', messageId: 'm1', policyVersion: 'v1' },
  { accountId: 'acct', messageId: 'm2', policyVersion: 'v2' },
];

function fakeTransaction(result: number | Error) {
  const events: string[] = [];
  let scope: { accountId: string; records: typeof records } | undefined;
  const transaction: AiAdvisoryRetentionTransaction = {
    async deleteAdvisories(input) {
      events.push('delete');
      scope = input;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const runner = {
    async transaction<T>(work: (tx: AiAdvisoryRetentionTransaction) => Promise<T>): Promise<T> {
      events.push('begin');
      try {
        const value = await work(transaction);
        events.push('commit');
        return value;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  return { runner, events, get scope() { return scope; } };
}

test('executes only the explicit account-bound batch in one transaction and returns actual count', async () => {
  const fake = fakeTransaction(1);
  assert.equal(await executeAiAdvisoryRetentionBatch(fake.runner, { accountId: 'acct', records }), 1);
  assert.deepEqual(fake.events, ['begin', 'delete', 'commit']);
  assert.deepEqual(fake.scope, { accountId: 'acct', records });
});

test('propagates delete failure after transaction rollback', async () => {
  const failure = new Error('delete failed');
  const fake = fakeTransaction(failure);
  await assert.rejects(executeAiAdvisoryRetentionBatch(fake.runner, { accountId: 'acct', records }), failure);
  assert.deepEqual(fake.events, ['begin', 'delete', 'rollback']);
});

test('rejects broadened, duplicate, oversized, or impossible deletion batches before transaction', async () => {
  const fake = fakeTransaction(0);
  await assert.rejects(executeAiAdvisoryRetentionBatch(fake.runner, { accountId: 'acct', records: [{ ...records[0], accountId: 'other' }] }), /match accountId/);
  await assert.rejects(executeAiAdvisoryRetentionBatch(fake.runner, { accountId: 'acct', records: [records[0], records[0]] }), /duplicate/);
  await assert.rejects(executeAiAdvisoryRetentionBatch(fake.runner, { accountId: 'acct', records: Array.from({ length: 501 }, (_, i) => ({ accountId: 'acct', messageId: `m${i}`, policyVersion: 'v1' })) }), /at most 500/);
  const impossible = fakeTransaction(3);
  await assert.rejects(executeAiAdvisoryRetentionBatch(impossible.runner, { accountId: 'acct', records }), /invalid deletion count/);
  assert.deepEqual(impossible.events, ['begin', 'delete', 'rollback']);
  assert.deepEqual(fake.events, []);
});
