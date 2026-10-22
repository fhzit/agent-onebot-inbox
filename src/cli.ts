import { fileURLToPath } from 'node:url';
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env, fetcher: Fetcher = fetch, print: (text: string) => void = console.log): Promise<void> {
  const base = env.AOI_API_URL;
  if (!base) throw new Error('AOI_API_URL is required; configure it to point at the running inbox API (server memory is process-local).');
  let parsedBase: URL;
  try { parsedBase = new URL(base); } catch { throw new Error('AOI_API_URL must be a valid absolute URL'); }
  const [command, ...rest] = args;
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options.set(arg, value); i++;
    } else positional.push(arg);
  }
  const params = new URLSearchParams();
  if (options.has('--account')) params.set('account_id', options.get('--account')!);
  let path: string;
  switch (command) {
    case 'accounts': path = '/api/accounts'; break;
    case 'unread': case 'recent':
      params.set('limit', options.get('--limit') ?? (command === 'unread' ? '50' : '50'));
      path = '/api/messages'; break;
    case 'summary':
      if (options.has('--since')) params.set('since', options.get('--since')!);
      path = '/api/summary'; break;
    case 'search':
      if (!positional.length) throw new Error('search requires a query');
      params.set('limit', '200'); path = '/api/messages'; break;
    default: throw new Error('Usage: aoi accounts|unread|recent|summary|search <query> [--account ID] [--limit N] [--since ISO]');
  }
  const target = new URL(path, parsedBase);
  target.search = params.toString();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (env.AOI_API_TOKEN) headers.authorization = `Bearer ${env.AOI_API_TOKEN}`;
  const response = await fetcher(target, { method: 'GET', headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`API request failed (${response.status}): ${text}`);
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new Error('API returned invalid JSON'); }
  if (command === 'search') {
    const messages = (result as { messages?: Array<{ plain_text?: string }> }).messages ?? [];
    const query = positional.join(' ').toLocaleLowerCase();
    result = { messages: messages.filter(message => message.plain_text?.toLocaleLowerCase().includes(query)) };
  }
  print(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}