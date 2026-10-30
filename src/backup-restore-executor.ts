import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { buildBackupRestorePlan, type RestoreArchiveEntry } from './backup-restore-plan.js';
import type { BackupRestorePreview } from './backup-restore-runtime.js';

export interface BackupRestoreExecutionOptions {
  /** Must be exactly true before any filesystem changes are allowed. */
  apply?: boolean;
}

export interface BackupRestoreExecutionResult {
  mode: 'dry-run' | 'applied';
  preview: BackupRestorePreview;
  written: string[];
}

/**
 * Validate and preview by default. Applying creates new files only: existing targets,
 * symlinked path components, and paths outside the resolved root are rejected.
 * Database restore is deliberately not part of this executor.
 */
export async function executeBackupRestore(
  root: string,
  manifest: unknown,
  entries: readonly RestoreArchiveEntry[],
  options: BackupRestoreExecutionOptions = {},
): Promise<BackupRestoreExecutionResult> {
  const absoluteRoot = resolve(root);
  if (!root) throw new Error('Invalid restore root');
  const plan = buildBackupRestorePlan(absoluteRoot, manifest, entries);
  const preview: BackupRestorePreview = {
    version: 1,
    files: plan.map(({ path, destination, size, sha256 }) => ({ path, destination, size, sha256 })),
    totalBytes: plan.reduce((total, file) => total + file.size, 0),
  };
  if (options.apply !== true) return { mode: 'dry-run', preview, written: [] };

  await mkdir(absoluteRoot, { recursive: true });
  await assertDirectoryNotSymlink(absoluteRoot);
  const written: string[] = [];
  for (const file of plan) {
    const rel = relative(absoluteRoot, file.destination);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Restore destination escapes root: ${file.path}`);
    const parts = rel.split(sep);
    let current = absoluteRoot;
    for (const part of parts.slice(0, -1)) {
      current = resolve(current, part);
      try { await mkdir(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await assertDirectoryNotSymlink(current);
    }
    // wx prevents overwriting files and also closes the common pre-check race.
    await writeFile(file.destination, file.data, { flag: 'wx' });
    written.push(file.destination);
  }
  return { mode: 'applied', preview, written };
}

async function assertDirectoryNotSymlink(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Restore path component is not a real directory: ${path}`);
}
