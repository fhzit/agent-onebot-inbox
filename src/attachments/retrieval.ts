import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export type ProviderFileRetriever = (providerFileId: string) => Promise<string>;
export type RetrievedAttachment = { bytes: Buffer; filename: string; size: number };

function isWithinRoot(file: string, roots: readonly string[]): boolean {
  return roots.some(root => {
    const relative = path.relative(root, file);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  });
}

/** Retrieve a provider-owned file ID, then enforce the local path sandbox before reading. */
export async function retrieveAttachment(
  providerFileId: string,
  retrieveProviderPath: ProviderFileRetriever,
  allowedRoots: readonly string[],
  maxBytes: number,
): Promise<RetrievedAttachment> {
  if (typeof providerFileId !== 'string' || providerFileId.trim().length === 0) throw new Error('Provider file ID is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid file size limit');
  const providerPath = await retrieveProviderPath(providerFileId);
  if (!path.isAbsolute(providerPath)) throw new Error('File path must be absolute');
  const roots = await Promise.all(allowedRoots.map(root => realpath(root)));
  const canonical = await realpath(providerPath);
  if (!isWithinRoot(canonical, roots)) throw new Error('File is outside allowed roots');
  const handle = await open(providerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw new Error('Path must resolve to a regular file');
    if (details.size > maxBytes) throw new Error('File exceeds configured size limit');
    // Resolve the opened descriptor itself, not the pathname validated before open.
    let openedPath: string;
    try {
      openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch {
      const afterOpen = await realpath(providerPath);
      const pathStat = await stat(afterOpen);
      if (pathStat.dev !== details.dev || pathStat.ino !== details.ino) throw new Error('File changed during retrieval');
      openedPath = afterOpen;
    }
    if (!isWithinRoot(openedPath, roots)) throw new Error('File is outside allowed roots');
    const chunks: Buffer[] = [];
    let total = 0;
    const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1));
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, maxBytes + 1 - total), total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error('File exceeds configured size limit');
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return { bytes: Buffer.concat(chunks, total), filename: path.basename(openedPath), size: total };
  } finally {
    await handle.close();
  }
}
