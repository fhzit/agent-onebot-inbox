import { resolve, relative, isAbsolute } from 'node:path';
import { backupSha256, validateBackupImportManifest, type BackupManifest } from './backup-manifest-validation.js';

export interface RestoreArchiveEntry {
  path: string;
  data: Uint8Array;
}

export interface RestorePlanEntry {
  path: string;
  destination: string;
  size: number;
  sha256: string;
  data: Uint8Array;
}

/** Validate archive payloads and return a deterministic write plan; never extracts or writes. */
export function buildBackupRestorePlan(root: string, manifest: unknown, entries: readonly RestoreArchiveEntry[]): RestorePlanEntry[] {
  const absoluteRoot = resolve(root);
  if (!root || !absoluteRoot) throw new Error('Invalid restore root');
  const inspected = entries.map(entry => {
    if (!entry || typeof entry.path !== 'string' || !(entry.data instanceof Uint8Array)) throw new Error('Invalid backup archive entry');
    return { path: entry.path, size: entry.data.byteLength, sha256: backupSha256(entry.data) };
  });
  const validated: BackupManifest = validateBackupImportManifest(manifest, inspected);
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  const plan = validated.files.map(file => {
    const destination = resolve(absoluteRoot, ...file.path.split('/'));
    const rel = relative(absoluteRoot, destination);
    if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
      throw new Error(`Restore destination escapes root: ${file.path}`);
    }
    const entry = byPath.get(file.path)!;
    return { path: file.path, destination, size: file.size, sha256: file.sha256, data: entry.data };
  });
  return plan.sort((a, b) => a.path.localeCompare(b.path));
}
