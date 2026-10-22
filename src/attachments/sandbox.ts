import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export type AllowedFile = { realPath: string; size: number; basename: string };

export async function resolveAllowedFile(inputPath: string, allowedRoots: readonly string[], maxBytes: number): Promise<AllowedFile> {
  if (!path.isAbsolute(inputPath)) throw new Error('File path must be absolute');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid file size limit');
  const realPath = await realpath(inputPath);
  const roots = await Promise.all(allowedRoots.map(root => realpath(root)));
  const allowed = roots.some(root => {
    const relative = path.relative(root, realPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error('File is outside allowed roots');
  const details = await stat(realPath);
  if (!details.isFile()) throw new Error('Path must resolve to a regular file');
  if (details.size > maxBytes) throw new Error('File exceeds configured size limit');
  return { realPath, size: details.size, basename: path.basename(realPath) };
}
