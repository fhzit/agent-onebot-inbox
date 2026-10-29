/** Metadata for a backup archive already produced and independently verified. */
export interface BackupInventoryRecord {
  id: string;
  archivePath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface BackupRetentionPlan {
  keep: BackupInventoryRecord[];
  remove: BackupInventoryRecord[];
}

/**
 * Produce a deterministic retention plan without deleting or modifying archives.
 * The newest `keepNewest` records are retained; older records are removable only
 * when they predate `olderThan`. Ties use id, so plans are stable across runs.
 */
export function planBackupRetention(
  records: readonly BackupInventoryRecord[],
  options: { keepNewest: number; olderThan: string },
): BackupRetentionPlan {
  if (!Number.isSafeInteger(options.keepNewest) || options.keepNewest < 0) {
    throw new Error('keepNewest must be a non-negative safe integer');
  }
  const cutoff = Date.parse(options.olderThan);
  if (!Number.isFinite(cutoff)) throw new Error('olderThan must be a valid timestamp');

  const ids = new Set<string>();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) {
      throw new Error('Backup inventory contains an invalid or duplicate id');
    }
    ids.add(record.id);
    if (typeof record.archivePath !== 'string' || !record.archivePath ||
        typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
        !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0) {
      throw new Error(`Invalid backup inventory record: ${record.id}`);
    }
  }

  const newestFirst = [...records].sort((a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const protectedIds = new Set(newestFirst.slice(0, options.keepNewest).map(record => record.id));
  const keep: BackupInventoryRecord[] = [];
  const remove: BackupInventoryRecord[] = [];
  for (const record of newestFirst) {
    if (protectedIds.has(record.id) || Date.parse(record.createdAt) >= cutoff) keep.push(record);
    else remove.push(record);
  }
  return { keep, remove };
}
