import assert from 'node:assert/strict';
import test from 'node:test';
import { planBackupRetention, type BackupInventoryRecord } from '../src/backup-inventory.js';

const rows: BackupInventoryRecord[] = [
  { id: 'older', archivePath: '/backups/older.tar.gz', createdAt: '2025-01-01T00:00:00.000Z', sizeBytes: 20 },
  { id: 'mid', archivePath: '/backups/mid.tar.gz', createdAt: '2025-02-01T00:00:00.000Z', sizeBytes: 30 },
  { id: 'new', archivePath: '/backups/new.tar.gz', createdAt: '2025-03-01T00:00:00.000Z', sizeBytes: 40 },
];

test('plans deterministic retention while protecting newest and all newer-than-cutoff backups', () => {
  const result = planBackupRetention(rows, { keepNewest: 1, olderThan: '2025-02-01T00:00:00Z' });
  assert.deepEqual(result.keep.map(row => row.id), ['new', 'mid']);
  assert.deepEqual(result.remove.map(row => row.id), ['older']);
  assert.deepEqual(planBackupRetention([...rows].reverse(), { keepNewest: 1, olderThan: '2025-02-01T00:00:00Z' }), result);
});

test('supports zero newest retention but never marks cutoff-equal backups removable', () => {
  const result = planBackupRetention(rows, { keepNewest: 0, olderThan: '2025-02-01T00:00:00Z' });
  assert.deepEqual(result.keep.map(row => row.id), ['new', 'mid']);
  assert.deepEqual(result.remove.map(row => row.id), ['older']);
});

test('rejects invalid policy and ambiguous inventory metadata', () => {
  assert.throws(() => planBackupRetention(rows, { keepNewest: -1, olderThan: '2025-02-01' }), /keepNewest/);
  assert.throws(() => planBackupRetention(rows, { keepNewest: 1, olderThan: 'bad' }), /olderThan/);
  assert.throws(() => planBackupRetention([rows[0]!, rows[0]!], { keepNewest: 1, olderThan: '2025-02-01' }), /duplicate id/);
  assert.throws(() => planBackupRetention([{ ...rows[0]!, sizeBytes: -1 }], { keepNewest: 1, olderThan: '2025-02-01' }), /Invalid backup inventory/);
});
