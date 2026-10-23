import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'public', 'admin.html'), 'utf8');
const encoded = Buffer.from(html).toString('base64');
const target = path.join(root, 'src', 'admin-page.ts');
await writeFile(target, `// Generated from public/admin.html by scripts/embed-admin.mjs.\nexport const adminPage = Buffer.from('${encoded}', 'base64').toString('utf8');\n`);
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('admin inline script is missing');
const check = await import('node:child_process').then(({ spawnSync }) => spawnSync(process.execPath, ['--check', '-'], { input: script, encoding: 'utf8' }));
if (check.status !== 0) throw new Error(`Invalid admin inline script: ${check.stderr}`);
