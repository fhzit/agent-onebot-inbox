import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { previewBackupRestore } from './backup-restore-runtime.js';

export interface BackupRestoreEntriesInput {
  entries: Array<{ path: string; data_base64: string }>;
}

/** Parse operator-supplied JSON inventories and return a validated preview only. */
export function previewBackupRestoreJson(root: string, manifestText: string, entriesText: string): string {
  const manifest: unknown = JSON.parse(manifestText);
  const parsed: unknown = JSON.parse(entriesText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray((parsed as Record<string, unknown>).entries)) {
    throw new Error('Entries JSON must be an object containing an entries array');
  }
  const entries = (parsed as BackupRestoreEntriesInput).entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.data_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data_base64)) {
      throw new Error('Each entry must contain a path and valid base64 data_base64');
    }
    return { path: entry.path, data: Buffer.from(entry.data_base64, 'base64') };
  });
  return JSON.stringify(previewBackupRestore(root, manifest, entries), null, 2);
}

export async function runBackupRestorePreviewCli(args: string[], print: (text: string) => void = console.log): Promise<void> {
  if (args.length !== 3) throw new Error('Usage: aoi backup-restore-preview <restore-root> <manifest.json> <entries.json>');
  const [root, manifestPath, entriesPath] = args as [string, string, string];
  const [manifest, entries] = await Promise.all([readFile(manifestPath, 'utf8'), readFile(entriesPath, 'utf8')]);
  print(previewBackupRestoreJson(root, manifest, entries));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBackupRestorePreviewCli(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
