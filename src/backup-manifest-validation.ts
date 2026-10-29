import { createHash } from 'node:crypto';

export const MAX_BACKUP_MANIFEST_FILES = 10_000;
export const MAX_BACKUP_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_BACKUP_TOTAL_BYTES = 512 * 1024 * 1024;

export interface BackupManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  version: 1;
  files: BackupManifestFile[];
}

export interface BackupImportEntry {
  path: string;
  size: number;
  sha256: string;
}

/** Validate an import manifest against inspected archive entries. This does not extract or write files. */
export function validateBackupImportManifest(manifest: unknown, entries: readonly BackupImportEntry[]): BackupManifest {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid backup manifest');
  const candidate = manifest as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.files)) throw new Error('Unsupported or invalid backup manifest version');
  if (candidate.files.length > MAX_BACKUP_MANIFEST_FILES || entries.length > MAX_BACKUP_MANIFEST_FILES) throw new Error('Backup manifest exceeds file count limit');
  const listed = new Map<string, BackupManifestFile>();
  let total = 0;
  for (const raw of candidate.files) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid backup manifest file record');
    const record = raw as Record<string, unknown>;
    if (typeof record.path !== 'string' || !isSafeRelativePath(record.path)) throw new Error('Unsafe backup manifest path');
    if (listed.has(record.path)) throw new Error(`Duplicate backup manifest path: ${record.path}`);
    if (!Number.isSafeInteger(record.size) || (record.size as number) < 0 || (record.size as number) > MAX_BACKUP_FILE_BYTES) throw new Error(`Invalid backup file size: ${record.path}`);
    if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error(`Invalid backup checksum: ${record.path}`);
    total += record.size as number;
    if (total > MAX_BACKUP_TOTAL_BYTES) throw new Error('Backup manifest exceeds total size limit');
    listed.set(record.path, { path: record.path, size: record.size as number, sha256: record.sha256 });
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !isSafeRelativePath(entry.path)) throw new Error('Unsafe backup entry path');
    if (seen.has(entry.path)) throw new Error(`Duplicate backup entry path: ${entry.path}`);
    seen.add(entry.path);
    const file = listed.get(entry.path);
    if (!file) throw new Error(`Unlisted backup entry: ${entry.path}`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_BACKUP_FILE_BYTES) throw new Error(`Invalid backup entry size: ${entry.path}`);
    if (file.size !== entry.size) throw new Error(`Backup size mismatch: ${entry.path}`);
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || file.sha256 !== entry.sha256) throw new Error(`Backup checksum mismatch: ${entry.path}`);
  }
  if (seen.size !== listed.size) throw new Error('Backup manifest is missing archive entries');
  return { version: 1, files: [...listed.values()] };
}

/** Compute the lowercase SHA-256 expected by the manifest contract. */
export function backupSha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 4096 || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false;
  const parts = path.split('/');
  return parts.every(part => part !== '' && part !== '.' && part !== '..');
}
