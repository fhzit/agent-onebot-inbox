import { buildBackupRestorePlan, type RestoreArchiveEntry } from './backup-restore-plan.js';

/** Operator-reviewable restore item; intentionally omits archive payload bytes. */
export interface BackupRestorePreviewFile {
  path: string;
  destination: string;
  size: number;
  sha256: string;
}

/** A validated preview only. Creating it never extracts files or restores a database. */
export interface BackupRestorePreview {
  version: 1;
  files: BackupRestorePreviewFile[];
  totalBytes: number;
}

/**
 * Validate a backup manifest and the complete archive inventory/checksums, then
 * return an operator-confirmable plan. This helper performs no filesystem or
 * database writes; callers must separately obtain confirmation and execute a
 * restore through an explicitly side-effecting path.
 */
export function previewBackupRestore(
  root: string,
  manifest: unknown,
  entries: readonly RestoreArchiveEntry[],
): BackupRestorePreview {
  const plan = buildBackupRestorePlan(root, manifest, entries);
  const files = plan.map(({ path, destination, size, sha256 }) => ({ path, destination, size, sha256 }));
  return {
    version: 1,
    files,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}
