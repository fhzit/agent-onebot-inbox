import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { AccountConfig, AppConfig } from './config.js';
import type { NormalizedMessage, OneBotEvent } from './normalize.js';
import { normalizeEvent } from './normalize.js';
import { MessageStore, type InboxQuery } from './store.js';
import { createMcpService } from './mcp.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { PostgresMessageStore } from './postgres-store.js';
import { classifyActionResponse, resolveReverseWsAccount } from './reverse-ws.js';
import { applyPriority, type PriorityConfig } from './priority.js';
import { RuntimeOneBotService } from './runtime-onebot-service.js';

export type Peer = { account: AccountConfig; socket: WebSocket; connectedAt: number; pending: Map<string, (value: unknown) => void> };
export type Runtime = { close: () => Promise<void>; store: MessageStore | PostgresMessageStore; peers: Map<string, Peer>; accounts: AccountConfig[] };
type Logger = { info: (data: unknown, message?: string) => void; warn: (data: unknown, message?: string) => void; error: (data: unknown, message?: string) => void };
const logger: Logger = {
  info: (data, message) => console.log(JSON.stringify({ level: 'info', message, ...asRecord(data) })),
  warn: (data, message) => console.warn(JSON.stringify({ level: 'warn', message, ...asRecord(data) })),
  error: (data, message) => console.error(JSON.stringify({ level: 'error', message, ...asRecord(data) })),
};
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function bearer(req: IncomingMessage): string { const h = req.headers.authorization ?? ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; }
async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > max) throw new Error('BODY_TOO_LARGE'); chunks.push(b); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function respond(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
}
function safeTokenEqual(a:string,b:string):boolean{const l=createHmac('sha256','aoi').update(a).digest(),r=createHmac('sha256','aoi').update(b).digest();return timingSafeEqual(l,r);}
function accountById(config:AppConfig,id:string):AccountConfig|undefined{return config.accounts.find(a=>a.id===id&&a.enabled);}
function queryFilters(params: URLSearchParams): InboxQuery {
  const number = (name: string, fallback: number): number => { const raw=params.get(name); if(raw===null)return fallback; const n=Number(raw); if(!Number.isInteger(n)||n<0) throw new Error(`Invalid ${name}`); return n; };
  const type=params.get('type'); const priority=params.get('priority'); const at=params.get('at_me');
  if(type!==null&&type!=='private'&&type!=='group')throw new Error('Invalid type');
  if(priority!==null&&!['P0','P1','P2','P3','P4'].includes(priority))throw new Error('Invalid priority');
  if(at!==null&&at!=='true'&&at!=='false')throw new Error('Invalid at_me');
  return {account_id:params.get('account_id')??undefined,type:type as InboxQuery['type']??undefined,sender:params.get('sender')??undefined,priority:priority as InboxQuery['priority']??undefined,at_me:at===null?undefined:at==='true',keyword:params.get('keyword')??undefined,since:params.get('since')??undefined,until:params.get('until')??undefined,offset:number('offset',0),limit:number('limit',50)};
}
export async function startServer(config: AppConfig, store?: MessageStore | PostgresMessageStore, priorityConfig: PriorityConfig = { rules: [], watchPeople: [] }, options: { requireDatabase?: boolean; databaseUrl?: string } = {}): Promise<Runtime> {
  if(options.requireDatabase&&!options.databaseUrl)throw new Error('DATABASE_URL is required for durable runtime');
  if (!config.apiToken) throw new Error('API_TOKEN is required; authenticated API cannot run without a token');
  if (config.accounts.some(a => a.enabled && !a.access_token)) throw new Error('Every enabled account requires access_token');
  let pool:Pool|undefined; let runtimeStore:MessageStore|PostgresMessageStore=store??new MessageStore();
  if(!store&&options.databaseUrl){pool=new Pool({connectionString:options.databaseUrl,max:10,connectionTimeoutMillis:5000});try{const migrationDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','migrations');await pool.query('SELECT pg_advisory_lock($1)',[741029441]);try{await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');for(const file of(await readdir(migrationDir)).filter(name=>/^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort()){const found=await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[file]);if(!found.rowCount){await pool.query('BEGIN');try{await pool.query(await readFile(path.join(migrationDir,file),'utf8'));await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);await pool.query('COMMIT');}catch(e){await pool.query('ROLLBACK');throw e;}}}for(const account of config.accounts)await pool.query('INSERT INTO accounts(id,alias,self_id,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET alias=EXCLUDED.alias,self_id=EXCLUDED.self_id,enabled=EXCLUDED.enabled',[account.id,account.alias,account.self_id,account.enabled]);}finally{await pool.query('SELECT pg_advisory_unlock($1)',[741029441]);}runtimeStore=PostgresMessageStore.fromPool(pool);}catch(e){await pool.end();throw e;}}
  store=runtimeStore;
  if (!config.apiToken) throw new Error('API_TOKEN is required; authenticated API cannot run without a token');
  if (config.accounts.some(a => a.enabled && !a.access_token)) throw new Error('Every enabled account requires access_token');
  const peers = new Map<string, Peer>();
  const onebot = new RuntimeOneBotService(peers, store);
  let eventCount = 0; let duplicateCount = 0; let sendSuccess = 0; let sendFailure = 0;
  const server = createServer();
  const appHandler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') return respond(res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/ready') {
        const connected = [...peers.values()].filter(p => p.socket.readyState === WebSocket.OPEN).length;
        return respond(res, 200, { status: 'ready', database: pool ? 'connected' : 'not_configured', redis: 'not_configured', connected_transports: connected });
      }
      if (req.method === 'GET' && url.pathname === '/metrics') return respond(res, 200, `message_ingest_total ${eventCount}\nduplicate_event_total ${duplicateCount}\nsend_success_total ${sendSuccess}\nsend_failure_total ${sendFailure}\nconnected_transports ${[...peers.values()].filter(p => p.socket.readyState === WebSocket.OPEN).length}\n`);
      const eventsMatch = url.pathname.match(/^\/onebot\/v11\/events\/([^/]+)$/);
      if (req.method === 'POST' && eventsMatch) {
        const account = accountById(config, decodeURIComponent(eventsMatch[1]!));
        if (!account) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown or disabled account', retryable: false } });
        if (!account.access_token || !safeTokenEqual(account.access_token, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid transport token', retryable: false } });
        const event = await readBody(req, config.maxMessageBytes) as OneBotEvent;
        const normalized = normalizeEvent(account.id, account.provider, `http:${account.id}`, event);
        const message = normalized ? applyPriority(normalized, priorityConfig) : null;
        if (!message) return respond(res, 200, { status: 'ignored' });
        const result = await store.insert(message); eventCount++; if (!result.inserted) duplicateCount++;
        return respond(res, 200, { status: result.inserted ? 'stored' : 'duplicate', message_id: result.message.id });
      }
      if (req.method === 'GET' && url.pathname === '/api/accounts') {
        if (config.apiToken && !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        return respond(res, 200, { accounts: config.accounts.map(({ access_token: _secret, ...a }) => ({ ...a, connected: peers.has(a.id) && peers.get(a.id)!.socket.readyState === WebSocket.OPEN })) });
      }
      if (req.method === 'GET' && url.pathname === '/api/messages') {
        if (config.apiToken && !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const params = queryFilters(url.searchParams);
        if (params.account_id && !accountById(config, params.account_id)) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown account', retryable: false } });
        return respond(res, 200, await store.query(params));
      }
      if (req.method === 'GET' && url.pathname === '/api/summary') {
        if (config.apiToken && !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const accountId = url.searchParams.get('account_id') ?? undefined;
        if (accountId && !accountById(config, accountId)) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown account', retryable: false } });
        return respond(res, 200, await store.summary(accountId, url.searchParams.get('since') ?? undefined));
      }
      if (req.method === 'POST' && (url.pathname === '/api/messages/mark_processed' || url.pathname === '/api/messages/dismiss')) {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
        const id = typeof body.message_id === 'string' ? body.message_id : '';
        if (!id) return respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'message_id is required', retryable: false } });
        const state = url.pathname.endsWith('/dismiss') ? await store.dismiss(id) : await store.markProcessed(id);
        return state ? respond(res, 200, { state }) : respond(res, 404, { error: { code: 'MESSAGE_NOT_FOUND', message: 'Unknown message', retryable: false } });
      }
      if (req.method === 'POST' && url.pathname === '/api/messages/revoke') {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
        const account = accountById(config, String(body.account_id ?? ''));
        if (!account) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Explicit enabled account is required', retryable: false } });
        if (account.permission !== 'direct') return respond(res, 403, { error: { code: 'PERMISSION_DENIED', message: `Account permission is ${account.permission}`, retryable: false } });
        const rawId = body.message_id;
        const messageId = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^-?\d+$/.test(rawId) ? Number(rawId) : NaN;
        if (!Number.isSafeInteger(messageId) || messageId < -2147483648 || messageId > 2147483647) return respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'message_id must be a OneBot v11 int32', retryable: false } });
        const known = (await store.list(account.id, 200)).find(m => m.direction === 'outgoing' && m.external_message_id === String(messageId));
        if (!known) return respond(res, 404, { error: { code: 'MESSAGE_NOT_FOUND', message: 'Only known outgoing messages can be revoked', retryable: false } });
        const peer = peers.get(account.id);
        if (!peer || peer.socket.readyState !== WebSocket.OPEN) return respond(res, 503, { error: { code: 'TRANSPORT_UNAVAILABLE', message: 'No connected Reverse WS peer', retryable: true } });
        try {
          const response = await callWsAction(peer, 'delete_msg', { message_id: messageId }, 15000);
          return respond(res, 200, { status: 'success', action: 'delete_msg', provider_response: response });
        } catch (error) {
          const details = error instanceof Error && 'providerResponse' in error ? (error as Error & { providerResponse: unknown }).providerResponse : undefined;
          return respond(res, 502, { status: 'failed', error: { code: 'ACTION_FAILED', message: error instanceof Error ? error.message : 'Action failed', retryable: false, ...(details === undefined ? {} : { details }) } });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/messages/send') {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
        const account = accountById(config, String(body.account_id ?? ''));
        if (!account) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Explicit enabled account is required', retryable: false } });
        if (account.permission !== 'direct') return respond(res, 403, { error: { code: 'PERMISSION_DENIED', message: `Account permission is ${account.permission}`, retryable: false } });
        const clientRequestId = typeof body.client_request_id === 'string' ? body.client_request_id : '';
        const target = String(body.target_id ?? ''); const type = body.message_type;
        if (!clientRequestId || !target || (type !== 'private' && type !== 'group') || (typeof body.message !== 'string' && !Array.isArray(body.message))) return respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Explicit client_request_id, target_id, message_type and message are required', retryable: false } });
        try {
          const existing = (await store.list(account.id, 200)).find(m => m.client_request_id === clientRequestId);
          if (existing) return respond(res, 200, { status: 'duplicate', message: existing });
          const outgoing = await onebot.sendMessage(account, type, target, body.message as string | import('./normalize.js').Segment[], clientRequestId);
          sendSuccess++;
          return respond(res, 200, { status: 'sent', message: outgoing });
        } catch (error) { sendFailure++; const code = (error as { code?: string }).code; return respond(res, code === 'TRANSPORT_UNAVAILABLE' ? 503 : 502, { error: { code: code ?? 'ACTION_FAILED', message: error instanceof Error ? error.message : 'Action failed', retryable: code !== 'ACTION_REJECTED' } }); }
      }
      return respond(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found', retryable: false } });
    } catch (error) {
      const code = error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : error instanceof SyntaxError || error instanceof Error && error.message.startsWith('Invalid ') || error instanceof Error && error.message.includes('required') ? 400 : 500;
      logger.warn({ error: error instanceof Error ? error.message : 'unknown', path: url.pathname }, 'request failed');
      return respond(res, code, { error: { code: code === 413 ? 'PAYLOAD_TOO_LARGE' : code === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: code === 500 ? 'Request failed' : 'Invalid request', retryable: code === 500 } });
    }
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const mcp = createMcpService(config, store);
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') { respond(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use MCP POST', retryable: false } }); return; }
      if (!safeTokenEqual(config.apiToken, bearer(req))) { respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } }); return; }
      const transport = mcp.createHttpTransport();
      void mcp.server.connect(transport as unknown as import('@modelcontextprotocol/sdk/shared/transport.js').Transport).then(() => {
        transport.onerror = error => logger.warn({ error: error.message }, 'MCP transport error');
        return transport.handleRequest(req, res);
      }).catch(error => { logger.warn({ error: error instanceof Error ? error.message : 'MCP error' }, 'MCP request failed'); if (!res.headersSent) respond(res, 500, { error: { code: 'MCP_ERROR', message: 'MCP request failed', retryable: true } }); });
      return;
    }
    void appHandler(req, res);
  });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const match = url.pathname.match(/^\/onebot\/v11\/ws(?:\/([^/]+))?$/);
    if (!match) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    const pathAccountId = match[1] === undefined ? undefined : decodeURIComponent(match[1]);
    const selfHeader = String(request.headers['x-self-id'] ?? '');
    const selfId = selfHeader || undefined;
    const account = resolveReverseWsAccount(config.accounts.filter(a => a.enabled), pathAccountId, selfId);
    if (!account || !account.access_token || !safeTokenEqual(account.access_token, bearer(request))) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, account));
  });
  wss.on('connection', (socket: WebSocket, _request: IncomingMessage, account: AccountConfig) => {
    const old = peers.get(account.id); if (old) old.socket.close(4001, 'Replaced by new connection');
    const peer: Peer = { account, socket, connectedAt: Date.now(), pending: new Map() }; peers.set(account.id, peer);
    logger.info({ account_id: account.id, self_id: account.self_id }, 'OneBot transport connected');
    socket.on('message', async (raw: import('ws').RawData) => {
      let packet: unknown;
      try { packet = JSON.parse(raw.toString()); } catch { logger.warn({ account_id: account.id }, 'invalid OneBot JSON'); return; }
      const object = asRecord(packet);
      if (object.echo !== undefined) {
        const echo = String(object.echo);
        if (peer.pending.has(echo) && classifyActionResponse(packet, echo)) {
          const resolve = peer.pending.get(echo)!; peer.pending.delete(echo); resolve(packet); return;
        }
        if (object.status === 'ok' || object.status === 'failed') return;
      }
      const event = packet as OneBotEvent;
      if (String(event.self_id ?? account.self_id) !== account.self_id) { logger.warn({ account_id: account.id }, 'discarded mismatched self_id event'); return; }
      const normalized = normalizeEvent(account.id, account.provider, `reverse-ws:${account.id}`, event);
      const message = normalized ? applyPriority(normalized, priorityConfig) : null;
      if (!message) return;
      const result = await store.insert(message); eventCount++; if (!result.inserted) duplicateCount++;
    });
    socket.on('close', () => { if (peers.get(account.id) === peer) peers.delete(account.id); for (const [key, resolve] of peer.pending) { peer.pending.delete(key); resolve({ error: 'disconnected' }); } logger.warn({ account_id: account.id }, 'OneBot transport disconnected'); });
    socket.on('error', (err: Error) => logger.warn({ account_id: account.id, error: err.message }, 'OneBot socket error'));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  logger.info({ host: config.host, port: config.port, accounts: config.accounts.length }, 'Agent OneBot Inbox API started');
  return { store, peers, accounts: config.accounts, close: async () => { for (const peer of peers.values()) peer.socket.close(); wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); if (pool) await pool.end(); } };
}

function makeOutgoing(account: AccountConfig, requestId: string, externalId: string, type: 'private' | 'group', target: string, content: unknown): NormalizedMessage {
  const segments = Array.isArray(content) ? content as NormalizedMessage['segments'] : [{ type: 'text', data: { text: String(content) } }];
  const text = segments.filter(s => s.type === 'text').map(s => String(s.data.text ?? '')).join('');
  const now = new Date().toISOString();
  return { id: randomUUID(), account_id: account.id, provider_id: account.provider, transport_id: `outgoing:${account.id}`, direction: 'outgoing', external_message_id: externalId || null, client_request_id: requestId, event_fingerprint: '', conversation_id: `${account.id}:${type}:${target}`, conversation_type: type, group_id: type === 'group' ? target : null, peer_user_id: type === 'private' ? target : null, sender_id: account.self_id, sender_name: account.alias, sender_card: null, sent_at: now, received_at: now, plain_text: text, raw_message: content, segments, reply_to_message_id: null, at_users: segments.filter(s => s.type === 'at').map(s => String(s.data.qq ?? '')), at_me: false, at_all: false, priority: 'P2', priority_score: 35, requires_reply: false, urgent: false, deadline: null, raw_event: {} };
}
async function callHttpAction(account: AccountConfig, action: string, params: unknown): Promise<Record<string, unknown>> {
  const base = account.action_url!;
  const url = base.endsWith('/') ? `${base}${action}` : `${base}/${action}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (account.access_token) headers.authorization = `Bearer ${account.access_token}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP OneBot action returned ${response.status}`);
  return await response.json() as Record<string, unknown>;
}
function callWsAction(peer: Peer, action: string, params: unknown, timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const echo = randomUUID();
    const timer = setTimeout(() => { peer.pending.delete(echo); reject(new Error('OneBot action timed out')); }, timeout);
    peer.pending.set(echo, value => { clearTimeout(timer); const result = asRecord(value); if (result.status === 'failed' || Number(result.retcode ?? 0) !== 0) reject(new Error(String(result.message ?? 'OneBot action rejected'))); else resolve(value); });
    try { peer.socket.send(JSON.stringify({ action, params, echo }), error => { if (error) { clearTimeout(timer); peer.pending.delete(echo); reject(error); } }); }
    catch (error) { clearTimeout(timer); peer.pending.delete(echo); reject(error); }
  });
}
