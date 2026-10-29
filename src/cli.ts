import { fileURLToPath } from 'node:url';
import { verifyBackupArchive } from './backup-integrity.js';
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env, fetcher: Fetcher = fetch, print: (text: string) => void = console.log): Promise<void> {
  if (args[0] === 'backup-verify') {
    if (args.length !== 2 || args[1]!.startsWith('--')) throw new Error('Usage: aoi backup-verify <archive.tar|archive.tar.gz>');
    print(JSON.stringify(await verifyBackupArchive(args[1]!), null, 2));
    return;
  }
  const SEARCH_MAX_MESSAGES = 10_000;
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
    case 'health': path = '/health'; break;
    case 'provider-capabilities': path = '/api/admin/provider-capabilities'; break;
    case 'accounts': path = '/api/accounts'; break;
    case 'unread': case 'recent': case 'processed': case 'dismissed':
      if (command === 'unread') params.set('unread', 'true');
      if (command === 'processed') params.set('processed', 'true');
      if (command === 'dismissed') params.set('dismissed', 'true');
      params.set('limit', options.get('--limit') ?? '50');
      path = '/api/messages'; break;
    case 'summary':
      if (options.has('--since')) params.set('since', options.get('--since')!);
      path = '/api/summary'; break;
    case 'search':
      if (!positional.length) throw new Error('search requires a query');
      params.set('keyword', positional.join(' ')); params.set('limit', options.get('--limit') ?? '200'); params.set('offset', '0'); path = '/api/messages'; break;
    default: throw new Error('Usage: aoi accounts|unread|recent|summary|search <query> [--account ID] [--limit N] [--since ISO]');
  }
  const target = new URL(path, parsedBase);
  target.search = params.toString();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (env.AOI_API_TOKEN) headers.authorization = `Bearer ${env.AOI_API_TOKEN}`;
  if (command === 'search') {
    const fullTextResponse = await fetcher(target, { method: 'GET', headers });
    if (fullTextResponse.ok) {
      const text = await fullTextResponse.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const candidate = parsed as { total?: unknown } | null;
      if (!candidate || typeof candidate.total !== 'number') throw new Error('API returned invalid pagination metadata');
      if (candidate.total > SEARCH_MAX_MESSAGES) throw new Error(`Search exceeds maximum of ${SEARCH_MAX_MESSAGES} messages`);
      const body = parsed as { messages?: unknown; offset?: unknown; limit?: unknown; has_more?: unknown };
      if (!Array.isArray(body.messages) || !Number.isInteger(body.offset) || !Number.isInteger(body.limit) || typeof body.has_more !== 'boolean' || body.offset !== 0 || (body.has_more && body.messages.length !== body.limit) || (body.has_more && body.messages.length >= candidate.total) || (!body.has_more && body.messages.length !== candidate.total)) throw new Error('API returned invalid pagination metadata');
      print(JSON.stringify(parsed, null, 2));
      return;
    }
    // Older API deployments may not support the keyword parameter; use the complete paginated substring path there.
    if (!fullTextResponse.ok && fullTextResponse.status !== 400 && fullTextResponse.status !== 422) {
      const text = await fullTextResponse.text();
      throw new Error(`API request failed (${fullTextResponse.status}): ${text}`);
    }
    target.searchParams.delete('keyword');
    const messages: Array<{ plain_text?: string }> = [];
    let offset = 0;
    while (true) {
      target.searchParams.set('offset', String(offset));
      const response = await fetcher(target, { method: 'GET', headers });
      const text = await response.text();
      if (!response.ok) throw new Error(`API request failed (${response.status}): ${text}`);
      let page: unknown;
      try { page = JSON.parse(text); } catch { throw new Error('API returned invalid JSON'); }
      if (!page || typeof page !== 'object') throw new Error('API returned invalid pagination metadata');
      const body = page as { messages?: unknown; total?: unknown; offset?: unknown; limit?: unknown; has_more?: unknown };
      const total = body.total, pageOffset = body.offset, limit = body.limit;
      if (!Array.isArray(body.messages) || typeof total !== 'number' || !Number.isInteger(total) || typeof pageOffset !== 'number' || !Number.isInteger(pageOffset) || typeof limit !== 'number' || !Number.isInteger(limit) || typeof body.has_more !== 'boolean' || pageOffset !== offset || limit <= 0 || total < 0) throw new Error('API returned invalid pagination metadata');
      if (total > SEARCH_MAX_MESSAGES) throw new Error(`Search exceeds maximum of ${SEARCH_MAX_MESSAGES} messages`);
      if ((body.has_more && body.messages.length !== limit) || (body.has_more && offset + body.messages.length >= total) || (!body.has_more && offset + body.messages.length !== total)) throw new Error('API returned invalid pagination metadata');
      if (messages.length + body.messages.length > SEARCH_MAX_MESSAGES) throw new Error(`Search exceeds maximum of ${SEARCH_MAX_MESSAGES} messages`);
      messages.push(...body.messages as Array<{ plain_text?: string }>);
      if (!body.has_more) break;
      offset += body.messages.length;
    }
    const query = positional.join(' ').toLocaleLowerCase();
    print(JSON.stringify({ messages: messages.filter(message => message.plain_text?.toLocaleLowerCase().includes(query)) }, null, 2));
    return;
  }
  const response = await fetcher(target, { method: 'GET', headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`API request failed (${response.status}): ${text}`);
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new Error('API returned invalid JSON'); }
  print(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}