import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse the literal declarations in provider-capabilities.ts without importing runtime code. */
export function auditProviderCapabilities(source) {
  const commonMatch = source.match(/const COMMON_V11_ACTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const registryMatch = source.match(/const REGISTRY\s*:[\s\S]*?=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  const aliasesMatch = source.match(/const ACTION_ALIASES\s*:[\s\S]*?=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!commonMatch || !registryMatch || !aliasesMatch) {
    throw new Error('Could not locate capability, registry, or alias declarations');
  }
  const strings = text => [...text.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const common = strings(commonMatch[1]);
  // Resolve only known constant arrays with literal members and simple spreads.
  // Unknown identifiers/spread expressions fail closed rather than guessing.
  const declarations = new Map([['COMMON_V11_ACTIONS', common]]);
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
    const [, name, body] = match;
    if (name === 'COMMON_V11_ACTIONS') continue;
    const actions = [];
    const entries = body.split(',').map(entry => entry.trim()).filter(Boolean);
    let valid = true;
    for (const entry of entries) {
      const spread = entry.match(/^\.\.\.([\w]+)$/);
      const literal = entry.match(/^'([^']+)'$/);
      if (spread && declarations.has(spread[1])) actions.push(...declarations.get(spread[1]));
      else if (literal) actions.push(literal[1]);
      else { valid = false; break; }
    }
    if (valid) declarations.set(name, actions);
  }
  const providers = [];
  for (const match of registryMatch[1].matchAll(/([\w-]+)\s*:\s*([\w]+)\s*,?/g)) {
    const actions = declarations.has(match[2]) ? [...declarations.get(match[2])] : null;
    if (!actions) throw new Error(`Unknown action declaration ${match[2]} for ${match[1]}`);
    providers.push({
      provider: match[1], verification: 'unverified',
      actions, duplicateActions: duplicates(actions),
    });
  }
  const aliases = [];
  for (const match of aliasesMatch[1].matchAll(/([\w]+)\s*:\s*\[([^\]]*)\]/g)) {
    const members = strings(match[2]);
    if (members.length > 1) aliases.push({ name: match[1], members });
  }
  const aliasGroups = new Map();
  for (const alias of aliases) {
    const group = [...alias.members].sort().join('|');
    if (!aliasGroups.has(group)) aliasGroups.set(group, [...alias.members].sort());
  }
  return {
    verification: 'unverified',
    providers: providers.sort((a, b) => a.provider.localeCompare(b.provider)),
    aliases: [...aliasGroups.values()].sort((a, b) => a[0].localeCompare(b[0])),
    duplicateActions: duplicates(common),
  };
}

function duplicates(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([action]) => action).sort();
}

async function main() {
  const source = await readFile(path.join(root, 'src', 'provider-capabilities.ts'), 'utf8');
  process.stdout.write(`${JSON.stringify(auditProviderCapabilities(source), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
