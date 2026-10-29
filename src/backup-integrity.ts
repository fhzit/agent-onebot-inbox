import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

export interface BackupVerification {
  format: 'tar' | 'tar.gz';
  entries: number;
  files: number;
  directories: number;
  totalBytes: number;
}

/** Verify a plain or gzip-compressed POSIX tar archive without extracting or modifying it. */
export async function verifyBackupArchive(path: string): Promise<BackupVerification> {
  const info = await stat(path);
  if (info.size > MAX_COMPRESSED_BYTES) throw new Error('Backup archive exceeds compressed size limit');
  const probe = createReadStream(path, { start: 0, end: 1 });
  const first: Buffer[] = [];
  for await (const chunk of probe) first.push(Buffer.from(chunk));
  const magic = Buffer.concat(first);
  const compressed = magic[0] === 0x1f && magic[1] === 0x8b;
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    const source = createReadStream(path);
    const stream = compressed ? source.pipe(createGunzip()) : source;
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      if (length > MAX_UNCOMPRESSED_BYTES) {
        source.destroy();
        throw new Error('Backup archive exceeds uncompressed size limit');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('size limit')) throw error;
    if (compressed) throw new Error('Backup gzip stream is corrupt');
    throw error;
  }
  const bytes = Buffer.concat(chunks, length);
  const format: BackupVerification['format'] = compressed ? 'tar.gz' : 'tar';
  let offset = 0, entries = 0, files = 0, directories = 0, totalBytes = 0, zeroBlocks = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      zeroBlocks++;
      offset += 512;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks) throw new Error('Invalid tar archive: nonzero header after end marker');
    const storedChecksum = parseOctal(header.subarray(148, 156));
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (storedChecksum === null || checksum !== storedChecksum) throw new Error(`Invalid tar archive: header checksum mismatch at byte ${offset}`);
    const size = parseOctal(header.subarray(124, 136));
    if (size === null) throw new Error(`Invalid tar archive: invalid entry size at byte ${offset}`);
    const type = header[156]!;
    if (type !== 0 && type !== 48 && type !== 53) throw new Error(`Invalid tar archive: unsupported entry type ${type} at byte ${offset}`);
    if (type === 53 && size !== 0) throw new Error(`Invalid tar archive: directory entry has data at byte ${offset}`);
    const dataStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (dataStart + paddedSize > bytes.length) throw new Error(`Invalid tar archive: truncated entry data at byte ${offset}`);
    entries++;
    totalBytes += size;
    if (type === 53) directories++;
    else files++;
    offset = dataStart + paddedSize;
  }
  if (zeroBlocks < 2) throw new Error('Invalid tar archive: missing two-block end marker or truncated header');
  if (bytes.subarray(offset).some(byte => byte !== 0)) throw new Error('Invalid tar archive: trailing nonzero data');
  return { format, entries, files, directories, totalBytes };
}

function parseOctal(field: Buffer): number | null {
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  const value = Number.parseInt(text, 8);
  return Number.isSafeInteger(value) ? value : null;
}
