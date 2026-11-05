import { pathToFileURL } from 'node:url';

export function isLoopbackUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host) && host.split('.').slice(1).every(part => Number(part) <= 255);
}

export function validateMetrics(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('metrics response is empty');
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^\r\n]*\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]Inf)$/);
    if (!match) throw new Error('metrics response contains invalid exposition');
    names.add(match[1]);
  }
  for (const name of ['message_ingest_total', 'connected_transports']) if (!names.has(name)) throw new Error(`metrics response is missing ${name}`);
  return true;
}

export function assertSafeTarget(baseUrl, allowNonLoopback = false) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('BASE_URL must be a valid absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('BASE_URL must be an HTTP(S) origin/path without credentials, query, or fragment');
  if (!allowNonLoopback && !isLoopbackUrl(baseUrl)) throw new Error('Refusing non-loopback BASE_URL; set SMOKE_ALLOW_NON_LOOPBACK=1 to opt in');
  return url.toString().replace(/\/$/, '');
}

async function run() {
  const base = assertSafeTarget(process.env.BASE_URL ?? '', process.env.SMOKE_ALLOW_NON_LOOPBACK === '1');
  const token = process.env.API_TOKEN;
  if (!token) throw new Error('API_TOKEN is required for the authenticated admin check');
  const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 5000);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000) throw new Error('SMOKE_TIMEOUT_MS must be between 1 and 60000');
  const get = async (path, authToken) => {
    const headers = authToken ? { authorization: `Bearer ${authToken}` } : {};
    const response = await fetch(`${base}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    return response;
  };
  for (const [path, expected] of [['/health', 200], ['/ready', 200]]) {
    const response = await get(path);
    if (response.status !== expected) throw new Error(`${path} returned HTTP ${response.status}, expected ${expected}`);
    const body = await response.json();
    if (body?.status !== (path === '/health' ? 'ok' : 'ready')) throw new Error(`${path} returned an unexpected status`);
  }
  const metrics = await get('/metrics');
  if (metrics.status !== 200) throw new Error(`/metrics returned HTTP ${metrics.status}`);
  validateMetrics(await metrics.text());
  const unauthenticated = await get('/api/admin/notifications');
  if (unauthenticated.status !== 401) throw new Error(`admin unauthenticated check returned HTTP ${unauthenticated.status}, expected 401`);
  const authenticated = await get('/api/admin/notifications', token);
  if (authenticated.status !== 200) throw new Error(`admin authenticated check returned HTTP ${authenticated.status}, expected 200`);
  process.stdout.write('Deployment smoke checks passed (health, readiness, metrics, admin auth).\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { process.stderr.write(`Deployment smoke check failed: ${error.message}\n`); process.exitCode = 1; });
}
