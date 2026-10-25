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
import { MemoryPriorityStore, PostgresPriorityStore, type PriorityStore } from './priority-store.js';
import { MemoryAccountStore, PostgresAccountStore, type AccountStore } from './account-store.js';
import { PostgresAuditStore,type AuditStore } from './audit-store.js';
import type { PriorityRule } from './priority.js';
import { HermesWebhookNotifier, type AgentNotification } from './agent-notifier.js';
import { PostgresNotificationDeliveryStore, type NotificationDelivery } from './notification-delivery-store.js';
import { MemoryNotificationConfigStore, PostgresNotificationConfigStore, type NotificationConfigStore } from './notification-settings.js';
import { RuntimeOneBotService } from './runtime-onebot-service.js';
import { PostgresOutboundIdempotencyStore } from './outbound-idempotency-store.js';
import { adminPage } from './admin-page.js';
import {ContactsCache} from './contacts-cache.js';
import {resolveContact} from './contact-resolver.js';
import {ContactSyncService} from './contact-sync.js';
import {PostgresContactsStore,type ContactsStore, type ContactsSnapshot} from './postgres-contacts-store.js';
import { PostgresNotificationQueue } from './notification-queue.js';
import { NotificationWorker } from './notification-worker.js';
import { createAttachmentRouteHandler } from './attachments/routes.js';
import { createOneBotFileRetriever } from './attachments/provider-adapter.js';

export type Peer = { account: AccountConfig; socket: WebSocket; connectedAt: number; pending: Map<string, (value: unknown) => void> };
class MemoryContactsStore implements ContactsStore{private snapshots=new Map<string,ContactsSnapshot>();async get(id:string){return structuredClone(this.snapshots.get(id)??{friends:[],groups:[],members:[],last_synced:{friends:null,groups:null,members:{}}});}async search(accountId:string,query:string,limit=50){const snapshot=await this.get(accountId);const contacts:import('./contact-resolver.js').Contact[]=[...snapshot.friends.map(f=>({account_id:accountId,qq_id:String(f.user_id),...(f.nickname!==undefined?{nickname:f.nickname}:{}),...(f.remark!==undefined?{remark:f.remark}:{})})),...snapshot.members.flatMap(g=>g.members.map(m=>({account_id:accountId,qq_id:String(m.user_id),...(m.nickname!==undefined?{nickname:m.nickname}:{}),...(m.card!==undefined?{card:m.card}:{}),group_id:g.group_id})))];const result=resolveContact(contacts,accountId,query);return{...result,results:result.candidates.slice(0,Math.min(100,Math.max(1,limit)))};}async replaceFriends(id:string,rows:readonly import('./contacts-cache.js').Friend[],syncedAt=new Date()){const s=await this.get(id);s.friends=[...rows];s.last_synced.friends=syncedAt.toISOString();this.snapshots.set(id,s);}async replaceGroups(id:string,rows:readonly import('./contacts-cache.js').Group[],syncedAt=new Date()){const s=await this.get(id);s.groups=[...rows];s.last_synced.groups=syncedAt.toISOString();this.snapshots.set(id,s);}async replaceGroupMembers(id:string,groupId:string|number,rows:readonly import('./contacts-cache.js').GroupMember[],syncedAt=new Date()){const s=await this.get(id);s.members=s.members.filter(x=>x.group_id!==String(groupId));s.members.push({group_id:String(groupId),members:[...rows]});s.last_synced.members[String(groupId)]=syncedAt.toISOString();this.snapshots.set(id,s);}}
export type Runtime = { close: () => Promise<void>; store: MessageStore | PostgresMessageStore; peers: Map<string, Peer>; accounts: AccountConfig[]; address:()=>import('node:net').AddressInfo|null };
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
function accountsById(config:AppConfig,id:string):AccountConfig|undefined{return config.accounts.find(account=>account.id===id);}
export async function dispatchNotification(store:NotificationConfigStore,message:NormalizedMessage,account:AccountConfig|undefined,deliveryStore?:Pick<PostgresNotificationDeliveryStore,'record'>):Promise<boolean>{
  let history:NotificationDelivery|undefined;
  let succeeded=true;try{const settings=await store.get();if(!settings.enabled||!settings.webhookUrl||!settings.webhookSecret||!account)return true;const levels=['P0','P1','P2','P3','P4'];if(levels.indexOf(message.priority)>levels.indexOf(settings.minPriority))return true;const preview=settings.includePreview?message.plain_text.slice(0,240):'';const notifier=new HermesWebhookNotifier({url:settings.webhookUrl,secret:settings.webhookSecret,timeoutMs:settings.timeoutMs});const event:AgentNotification={event:'message.received',account:account.alias,message_id:message.id,priority:message.priority,sender:message.sender_name??message.sender_id,conversation:message.conversation_id,preview,reason:'Inbound message priority threshold matched'};history={event:'message.received',accountId:account.id,messageId:message.id,outcome:'failure'};let last:unknown;for(let attempt=0;attempt<settings.maxAttempts;attempt++){try{await notifier.notify(event);history.outcome='success';history.httpStatus=200;return true;}catch(error){last=error;const status=error instanceof Error?/returned HTTP ([1-5]\d{2})/.exec(error.message)?.[1]:undefined;if(status)history.httpStatus=Number(status);}}succeeded=false;throw last instanceof Error?last:new Error('Webhook failed');}catch(error){logger.warn({error:error instanceof Error?error.message:'unknown'},'notification delivery failed');return succeeded;}finally{if(history&&deliveryStore)try{await deliveryStore.record(history);}catch{logger.warn({},'notification history persistence failed');}}
}

type RuleRequest = { id?: unknown; kind?: unknown; weight?: unknown; priority?: unknown; keywords?: unknown; accountIds?: unknown; conversationTypes?: unknown; groupIds?: unknown; senderIds?: unknown; atMe?: unknown };
function validateRule(input: RuleRequest): PriorityRule {
  const id = typeof input.id === 'string' && input.id ? input.id : randomUUID();
  const list = (value: unknown, valid: (entry: unknown) => boolean, field: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100 || !value.every(valid)) throw new Error(`Invalid ${field}`);
    return [...new Set(value as string[])];
  };
  if (input.kind !== undefined && input.kind !== 'weighted' && input.kind !== 'hard') throw new Error('Invalid kind');
  if (input.weight !== undefined && (typeof input.weight !== 'number' || !Number.isInteger(input.weight) || input.weight < -100 || input.weight > 100)) throw new Error('Invalid weight');
  if (input.priority !== undefined && !['P0','P1','P2','P3','P4'].includes(String(input.priority))) throw new Error('Invalid priority');
  if (input.atMe !== undefined && typeof input.atMe !== 'boolean') throw new Error('Invalid atMe');
  const keywords=list(input.keywords,x=>typeof x==='string'&&x.length>0&&x.length<=100,'keywords');
  const accountIds=list(input.accountIds,x=>typeof x==='string'&&Boolean(x),'accountIds');
  const groupIds=list(input.groupIds,x=>typeof x==='string'&&Boolean(x),'groupIds');
  const senderIds=list(input.senderIds,x=>typeof x==='string'&&Boolean(x),'senderIds');
  const rawTypes=input.conversationTypes;
  if(rawTypes!==undefined&&(!Array.isArray(rawTypes)||!rawTypes.every(x=>x==='private'||x==='group')))throw new Error('Invalid conversationTypes');
  return {id,...(input.kind!==undefined?{kind:input.kind as 'weighted'|'hard'}:{}),...(input.weight!==undefined?{weight:input.weight as number}:{}),...(input.priority!==undefined?{priority:input.priority as NonNullable<PriorityRule['priority']>}:{}),...(keywords?{keywords}:{}),...(accountIds?{accountIds}:{}),...(groupIds?{groupIds}:{}),...(senderIds?{senderIds}:{}),...(rawTypes?{conversationTypes:rawTypes as NonNullable<PriorityRule['conversationTypes']>}:{}),...(input.atMe!==undefined?{atMe:input.atMe}:{} )};
}
function validateWatch(input: Record<string, unknown>): { id:string; userId:string; displayName:string; enabled:boolean; boost:number; accountIds?:string[] } {
  const str=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  if(input.id!==undefined&&!str(input.id,100))throw new Error('Invalid id');
  if(!str(input.userId,100)||!str(input.displayName,120))throw new Error('userId and displayName are required');
  if(typeof input.boost!=='number'||!Number.isInteger(input.boost)||input.boost<0||input.boost>100)throw new Error('boost must be 0..100');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new Error('enabled must be boolean');
  let accountIds: string[]|undefined;
  if(input.accountIds!==undefined){if(!Array.isArray(input.accountIds)||input.accountIds.length>100||!input.accountIds.every(x=>typeof x==='string'&&x))throw new Error('Invalid accountIds');accountIds=[...new Set(input.accountIds as string[])];}
  return {id:(input.id as string|undefined)??randomUUID(),userId:input.userId as string,displayName:input.displayName as string,enabled:(input.enabled as boolean|undefined)??true,boost:input.boost,...(accountIds?{accountIds}:{})};
}

function queryFilters(params: URLSearchParams): InboxQuery {
  const number = (name: string, fallback: number): number => { const raw=params.get(name); if(raw===null)return fallback; const n=Number(raw); if(!Number.isInteger(n)||n<0) throw new Error(`Invalid ${name}`); return n; };
  const type=params.get('type'); const priority=params.get('priority'); const at=params.get('at_me');
  const stateKeys=['unread','processed','dismissed'] as const; const stateFilters=stateKeys.filter(key=>params.get(key)!==null);
  if(stateFilters.length>1||stateFilters.some(key=>params.get(key)!=='true'))throw new Error('Invalid inbox state filter');
  if(type!==null&&type!=='private'&&type!=='group')throw new Error('Invalid type');
  if(priority!==null&&!['P0','P1','P2','P3','P4'].includes(priority))throw new Error('Invalid priority');
  if(at!==null&&at!=='true'&&at!=='false')throw new Error('Invalid at_me');
  return {account_id:params.get('account_id')??undefined,type:type as InboxQuery['type']??undefined,sender:params.get('sender')??undefined,priority:priority as InboxQuery['priority']??undefined,at_me:at===null?undefined:at==='true',keyword:params.get('keyword')??undefined,since:params.get('since')??undefined,until:params.get('until')??undefined,offset:number('offset',0),limit:number('limit',50), ...(stateFilters[0]?{state:stateFilters[0]}:{}) };
}
export async function startServer(config: AppConfig, store?: MessageStore | PostgresMessageStore, priorityConfig: PriorityConfig = { rules: [], watchPeople: [] }, options: { requireDatabase?: boolean; databaseUrl?: string; accountEncryptionKey?: string } = {}): Promise<Runtime> {
  if(options.requireDatabase&&!options.databaseUrl)throw new Error('DATABASE_URL is required for durable runtime');
  if(!config.apiToken)throw new Error('API_TOKEN is required; authenticated API cannot run without a token');
  let pool:Pool|undefined;let runtimeStore:MessageStore|PostgresMessageStore=store??new MessageStore();
  let auditStore:AuditStore|undefined;
  if(!store&&options.databaseUrl){
    if(!options.accountEncryptionKey)throw new Error('ACCOUNT_ENCRYPTION_KEY is required for persistent account settings');
    pool=new Pool({connectionString:options.databaseUrl,max:10,connectionTimeoutMillis:5000});
    try{
      const migrationDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','migrations');
      await pool.query('SELECT pg_advisory_lock($1)',[741029441]);
      try{
        await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
        for(const file of(await readdir(migrationDir)).filter(name=>/^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort()){
          const found=await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[file]);
          if(!found.rowCount){await pool.query('BEGIN');try{await pool.query(await readFile(path.join(migrationDir,file),'utf8'));await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);await pool.query('COMMIT');}catch(error){await pool.query('ROLLBACK');throw error;}}
        }
      }finally{await pool.query('SELECT pg_advisory_unlock($1)',[741029441]);}
      const postgresAccountStore=new PostgresAccountStore(pool,options.accountEncryptionKey);
      const managedAccounts=await postgresAccountStore.loadConfiguredAccounts();
      const managedIds=new Set(managedAccounts.map(account=>account.id));
      config.accounts=[...config.accounts.filter(account=>!managedIds.has(account.id)),...managedAccounts];
      for(const account of config.accounts)if(!managedIds.has(account.id))await postgresAccountStore.create(account);
      runtimeStore=PostgresMessageStore.fromPool(pool);
      auditStore=new PostgresAuditStore(pool);
    }catch(error){await pool.end();throw error;}
  }
  store=runtimeStore;
  const notificationDeliveryStore=pool?new PostgresNotificationDeliveryStore(pool):undefined;
  const notificationQueue=pool?new PostgresNotificationQueue(pool):undefined;
  const priorityStore: PriorityStore = pool ? new PostgresPriorityStore(pool) : new MemoryPriorityStore();
  const accountStore: AccountStore = pool ? new PostgresAccountStore(pool,options.accountEncryptionKey??'') : new MemoryAccountStore();
  const notificationStore: NotificationConfigStore = pool ? new PostgresNotificationConfigStore(pool,options.accountEncryptionKey??'') : new MemoryNotificationConfigStore();
  let activePriorityConfig = pool ? await priorityStore.list() : structuredClone(priorityConfig);
  if(!pool)for(const account of config.accounts)await accountStore.create(account);
  if (!config.apiToken) throw new Error('API_TOKEN is required; authenticated API cannot run without a token');
  if (config.accounts.some(a => a.enabled && !a.access_token)) throw new Error('Every enabled account requires access_token');
const peers = new Map<string, Peer>();
  const onebot = new RuntimeOneBotService(peers, store, 15000, pool ? new PostgresOutboundIdempotencyStore(pool) : undefined);
  const contactSearch:ContactsStore=pool?new PostgresContactsStore(pool):new MemoryContactsStore();
  const contactsCache=new ContactsCache();
  const contactsStore:ContactsStore=contactSearch;
  const contactSync=new ContactSyncService(onebot,contactsCache,contactsStore,options.accountEncryptionKey??config.apiToken);
  const attachmentHandler=createAttachmentRouteHandler({apiToken:config.apiToken,allowedRoots:(process.env.ATTACHMENT_ALLOWED_ROOTS??'').split(path.delimiter).filter(Boolean),maxBytes:Number(process.env.ATTACHMENT_MAX_BYTES??10*1024*1024),resolveAccount:accountId=>{const account=accountById(config,accountId);return account?{permission:account.permission,retrieve:createOneBotFileRetriever(onebot,account)}:undefined;}});
  const notificationWorker=notificationQueue?new NotificationWorker(notificationQueue,async item=>{
    if(!item.accountId||!item.messageId)return false;
    const [message]=await Promise.all([store.get(item.messageId)]);
    const account=accountsById(config,item.accountId);
    if(!message||!account)return false;
    return await dispatchNotification(notificationStore,message,account,notificationDeliveryStore);
  }):undefined;
  notificationWorker?.start();
  let eventCount = 0; let duplicateCount = 0; let sendSuccess = 0; let sendFailure = 0;
  const server = createServer();
  const appHandler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      if(req.method==='GET'&&url.pathname.startsWith('/api/attachments/')){if(await attachmentHandler(req,res))return;}
      if (req.method === 'GET' && (url.pathname === (config.adminBasePath ?? '/admin') || url.pathname === `${config.adminBasePath ?? '/admin'}/`)) {
        const html = adminPage;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        res.end(html);
        return;
      }
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
        const message = normalized ? applyPriority(normalized, activePriorityConfig) : null;
        if (!message) return respond(res, 200, { status: 'ignored' });
            const result=await store.insert(message); eventCount++; if(!result.inserted)duplicateCount++;else if(auditStore)void auditStore.record({actor:'onebot',action:'message.ingest',account_id:account.id,message_id:result.message.id,target_type:'message',target_id:result.message.id,result:'success'}).catch(error=>logger.warn({account_id:account.id,error:error instanceof Error?error.message:'audit failed'},'message audit write failed'));
            if(pool)await notificationQueue!.enqueue({event:'message.received',accountId:account.id,messageId:result.message.id,dedupeKey:`message.received:${account.id}:${result.message.id}`});
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
        const result = await store.query(params);
        const messages = await Promise.all(result.messages.map(async message => ({ ...message, state: await store.state(message.id) })));
        return respond(res, 200, { ...result, messages });
      }
      const adminAccounts=url.pathname.match(/^\/api\/admin\/accounts(?:\/([^/]+))?$/);
      if(adminAccounts){
        if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});
        const id=adminAccounts[1]?decodeURIComponent(adminAccounts[1]):undefined;
        if(req.method==='GET')return respond(res,200,{accounts:await accountStore.list()});
        if(req.method==='POST'||req.method==='PUT'){
            const actor='admin';
            try{const body=await readBody(req,config.maxMessageBytes);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Body must be an object');const value=body as Record<string,unknown>;
            const accountId=id??(typeof value.id==='string'&&value.id?value.id:randomUUID());
            for(const key of ['alias','self_id','provider'])if(typeof value[key]!=='string'||!(value[key] as string).trim())throw new Error(`${key} is required`);
            const provider=String(value.provider);if(!['napcat','snowluma'].includes(provider))throw new Error('provider must be napcat or snowluma');
            const permission=value.permission??'readonly';if(!['readonly','confirm','direct'].includes(String(permission)))throw new Error('Invalid permission');
            if(value.enabled!==undefined&&typeof value.enabled!=='boolean')throw new Error('enabled must be boolean');
            if(!id&&typeof value.access_token!=='string')throw new Error('access_token is required for new accounts');if(!id&&typeof value.access_token==='string'&&!value.access_token.trim())throw new Error('access_token is required for new accounts');
            const old=config.accounts.find(a=>a.id===accountId);const secret=typeof value.access_token==='string'&&value.access_token?value.access_token:old?.access_token;
            if(value.enabled!==false&&!secret)throw new Error('An enabled account requires access_token');
            const account:AccountConfig={id:accountId,alias:(value.alias as string).trim(),self_id:(value.self_id as string).trim(),provider,enabled:value.enabled!==false,permission:permission as AccountConfig['permission'],...(secret?{access_token:secret}:{}),...(typeof value.action_url==='string'&&value.action_url?{action_url:value.action_url}:{})};
            const auditChange={actor:'admin',action:id?'account.update':'account.create',account_id:accountId,target_type:'account',target_id:accountId,result:'success' as const,metadata:{provider:account.provider,enabled:account.enabled,permission:account.permission}};
            try{if(id){const updated=await accountStore.update(id,account);if(!updated){if(auditStore)await auditStore.record({...auditChange,result:'failure',metadata:{...auditChange.metadata,error:'Account not found'}});return respond(res,404,{error:{code:'NOT_FOUND',message:'Account not found',retryable:false}});}}
            else {await accountStore.create(account);}
            if(auditStore)await auditStore.record(auditChange);
            }catch(error){if(auditStore)await auditStore.record({...auditChange,result:'failure',metadata:{...auditChange.metadata,error:error instanceof Error?error.message:'Storage operation failed'}});throw error;}
            config.accounts=await accountStore.loadConfiguredAccounts();
            const changed=peers.get(accountId);if(changed){changed.socket.close();peers.delete(accountId);}
            return respond(res,id?200:201,{account:{id:account.id,alias:account.alias,self_id:account.self_id,provider:account.provider,enabled:account.enabled,permission:account.permission,access_token_configured:Boolean(secret),connected:false}});
          }catch(error){if(auditStore)await auditStore.record({actor:'admin',action:id?'account.update':'account.create',target_type:'account',target_id:id??null,result:'failure',metadata:{error:error instanceof Error?error.message:'Invalid account'}});return respond(res,400,{error:{code:'VALIDATION_ERROR',message:error instanceof Error?error.message:'Invalid account',retryable:false}});}
        }
        if(req.method==='DELETE'&&id){const auditDelete={actor:'admin',action:'account.delete',account_id:id,target_type:'account',target_id:id,result:'success' as const};try{const removed=await accountStore.remove(id);if(!removed){if(auditStore)await auditStore.record({...auditDelete,result:'failure',metadata:{error:'Account not found'}});return respond(res,404,{error:{code:'NOT_FOUND',message:'Account not found',retryable:false}});}if(auditStore)await auditStore.record(auditDelete);}catch(error){if(auditStore)await auditStore.record({...auditDelete,result:'failure',metadata:{error:error instanceof Error?error.message:'Delete failed'}});return respond(res,500,{error:{code:'PERSISTENCE_ERROR',message:'Could not persist account deletion',retryable:true}});}const index=config.accounts.findIndex(a=>a.id===id);if(index>=0)config.accounts.splice(index,1);const peer=peers.get(id);if(peer){peer.socket.close();peers.delete(id);}return respond(res,200,{deleted:true});}
      }
        if (req.method === 'GET' && url.pathname === '/api/admin/priority') {
          if (!safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, {error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});
          return respond(res,200,await priorityStore.list());
        }
        const rulePath=url.pathname.match(/^\/api\/admin\/priority\/rules(?:\/([^/]+))?$/);
        if(rulePath){
          if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});
          if(req.method==='GET')return respond(res,200,{rules:(await priorityStore.list()).rules});
          if(req.method==='POST'||req.method==='PUT'){
            try{const body=await readBody(req,config.maxMessageBytes);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Body must be an object');const input=body as RuleRequest;const idInPath=rulePath[1]?decodeURIComponent(rulePath[1]):undefined;const rule=validateRule({...input,...(idInPath?{id:idInPath}:{})});await priorityStore.putRule(rule);activePriorityConfig=await priorityStore.list();if(auditStore)await auditStore.record({actor:'admin',action:idInPath?'priority.rule.update':'priority.rule.create',target_type:'priority_rule',target_id:rule.id,result:'success',metadata:{enabled:true}});return respond(res,req.method==='POST'?201:200,{rule});}
            catch(error){if(auditStore)await auditStore.record({actor:'admin',action:'priority.rule.write',result:'failure',metadata:{error:error instanceof Error?error.message:'Invalid rule'}});return respond(res,400,{error:{code:'VALIDATION_ERROR',message:error instanceof Error?error.message:'Invalid rule',retryable:false}});}
          }
        if(req.method==='DELETE'&&rulePath[1]){const id=decodeURIComponent(rulePath[1]);let removed=false;try{removed=await priorityStore.deleteRule(id);if(removed)activePriorityConfig=await priorityStore.list();}catch(error){if(auditStore)await auditStore.record({actor:'admin',action:'priority.rule.delete',target_type:'priority_rule',target_id:id,result:'failure',metadata:{error:error instanceof Error?error.message:'Delete failed'}});return respond(res,500,{error:{code:'PERSISTENCE_ERROR',message:'Could not persist rule deletion',retryable:true}});}if(auditStore)await auditStore.record({actor:'admin',action:'priority.rule.delete',target_type:'priority_rule',target_id:id,result:removed?'success':'failure'});if(!removed)return respond(res,404,{error:{code:'NOT_FOUND',message:'Rule not found',retryable:false}});return respond(res,200,{deleted:true});}
        }
        const watchPath=url.pathname.match(/^\/api\/admin\/priority\/watch-people(?:\/([^/]+))?$/);
        if(watchPath){
          if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});
          if(req.method==='GET')return respond(res,200,{watchPeople:(await priorityStore.list()).watchPeople});
          if(req.method==='POST'||req.method==='PUT'){
            try{const body=await readBody(req,config.maxMessageBytes);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Body must be an object');const item=validateWatch({...body as Record<string,unknown>,...(watchPath[1]?{id:decodeURIComponent(watchPath[1])}:{})});for(const id of item.accountIds??[])if(!config.accounts.some(a=>a.id===id))throw new Error('Unknown account scope');const saved={id:item.id,userId:item.userId,displayName:item.displayName,enabled:item.enabled,boost:item.boost,...(item.accountIds?{accountIds:item.accountIds}:{})};await priorityStore.putWatchPerson(saved);activePriorityConfig=await priorityStore.list();if(auditStore)await auditStore.record({actor:'admin',action:watchPath[1]?'watch_person.update':'watch_person.create',target_type:'watch_person',target_id:item.id,result:'success',metadata:{enabled:item.enabled}});return respond(res,req.method==='POST'?201:200,{watchPerson:saved});}
            catch(error){return respond(res,400,{error:{code:'VALIDATION_ERROR',message:error instanceof Error?error.message:'Invalid watch person',retryable:false}});}
          }
          if(req.method==='DELETE'&&watchPath[1]){let id:string;try{id=decodeURIComponent(watchPath[1]);}catch{return respond(res,400,{error:{code:'VALIDATION_ERROR',message:'Invalid watch person id',retryable:false}});}let removed=false;try{removed=await priorityStore.deleteWatchPerson(id);if(removed)activePriorityConfig=await priorityStore.list();}catch(error){if(auditStore)await auditStore.record({actor:'admin',action:'watch_person.delete',target_type:'watch_person',target_id:id,result:'failure',metadata:{error:error instanceof Error?error.message:'Delete failed'}});return respond(res,500,{error:{code:'PERSISTENCE_ERROR',message:'Could not persist watch-person deletion',retryable:true}});}if(auditStore)await auditStore.record({actor:'admin',action:'watch_person.delete',target_type:'watch_person',target_id:id,result:removed?'success':'failure'});if(!removed)return respond(res,404,{error:{code:'NOT_FOUND',message:'Watch person not found',retryable:false}});return respond(res,200,{deleted:true});}
        }

      if(req.method==='GET'&&url.pathname==='/api/admin/notification-deliveries'){
        if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});
        if(!notificationDeliveryStore)return respond(res,503,{error:{code:'HISTORY_UNAVAILABLE',message:'Delivery history requires database configuration',retryable:false}});
        const raw=url.searchParams.get('limit');const limit=raw===null?50:Number(raw);if(!Number.isInteger(limit)||limit<1||limit>100)return respond(res,400,{error:{code:'VALIDATION_ERROR',message:'limit must be an integer from 1 to 100',retryable:false}});
        try{return respond(res,200,{deliveries:await notificationDeliveryStore.list(limit)});}catch{return respond(res,500,{error:{code:'PERSISTENCE_ERROR',message:'Could not read notification delivery history',retryable:true}});}
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/notifications') { if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});const value=await notificationStore.get();return respond(res,200,{settings:{...value,webhookSecret:undefined,webhookSecretConfigured:Boolean(value.webhookSecret)}}); }
      if (req.method === 'PUT' && url.pathname === '/api/admin/notifications') { if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});try{const body=await readBody(req,config.maxMessageBytes);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Body must be object');const input=body as Record<string,unknown>,previous=await notificationStore.get();const enabled=input.enabled===undefined?previous.enabled:input.enabled;const webhookUrl=input.webhookUrl===undefined?previous.webhookUrl:input.webhookUrl;const webhookSecret=input.webhookSecret===undefined?'':input.webhookSecret;const minPriority=input.minPriority??previous.minPriority;const includePreview=input.includePreview===undefined?previous.includePreview:input.includePreview;const timeoutMs=input.timeoutMs??previous.timeoutMs,maxAttempts=input.maxAttempts??previous.maxAttempts;if(typeof enabled!=='boolean'||typeof webhookUrl!=='string'||webhookUrl.length>2048||typeof webhookSecret!=='string'||webhookSecret.length>4096||typeof includePreview!=='boolean'||!['P0','P1','P2','P3','P4'].includes(String(minPriority))||typeof timeoutMs!=='number'||!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>60000||typeof maxAttempts!=='number'||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw new Error('Invalid notification settings');if(webhookUrl&&new URL(webhookUrl).protocol!=='https:')throw new Error('Webhook URL must use HTTPS');await notificationStore.put({enabled,webhookUrl,webhookSecret:webhookSecret||previous.webhookSecret,minPriority:minPriority as 'P0'|'P1'|'P2'|'P3'|'P4',includePreview,timeoutMs,maxAttempts});if(auditStore)await auditStore.record({actor:'admin',action:'notification.settings.update',target_type:'notification',target_id:'webhook',result:'success',metadata:{enabled,minPriority,includePreview,timeoutMs,maxAttempts,secretConfigured:Boolean(webhookSecret||previous.webhookSecret)}});const saved=await notificationStore.get();return respond(res,200,{settings:{...saved,webhookSecret:undefined,webhookSecretConfigured:Boolean(saved.webhookSecret)}});}catch(error){return respond(res,400,{error:{code:'VALIDATION_ERROR',message:error instanceof Error?error.message:'Invalid settings',retryable:false}});} }
      if (req.method === 'POST' && url.pathname === '/api/admin/notifications/test') { if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});const value=await notificationStore.get();if(!value.enabled||!value.webhookUrl||!value.webhookSecret)return respond(res,409,{error:{code:'NOTIFICATION_CONFIG_INCOMPLETE',message:'Enable notifications and configure URL/secret',retryable:false}});try{await new HermesWebhookNotifier({url:value.webhookUrl,secret:value.webhookSecret,timeoutMs:value.timeoutMs}).notify({event:'test',account:'admin-console',message_id:null,priority:value.minPriority,sender:'',conversation:'',preview:'',reason:'Admin notification test'});if(auditStore)await auditStore.record({actor:'admin',action:'notification.test',target_type:'notification',target_id:'webhook',result:'success'});return respond(res,200,{sent:true});}catch(error){if(auditStore)await auditStore.record({actor:'admin',action:'notification.test',target_type:'notification',target_id:'webhook',result:'failure',metadata:{error:error instanceof Error?error.message:'Delivery failed'}});return respond(res,502,{error:{code:'NOTIFICATION_TEST_FAILED',message:error instanceof Error?error.message:'Delivery failed',retryable:false}});} }
      const contactPath = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/contacts(?:\/(friends|groups|members|search|sync-friends|sync-groups|sync-members))?$/);
      if (contactPath) {
        if (!safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const account = accountById(config, decodeURIComponent(contactPath[1]!));
        if (!account) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown account', retryable: false } });
        try {
          const operation = contactPath[2];
          if (req.method === 'POST' && operation === 'sync-friends') return respond(res, 200, await contactSync.syncFriends(account));
          if (req.method === 'POST' && operation === 'sync-groups') return respond(res, 200, await contactSync.syncGroups(account));
          if (req.method === 'POST' && operation === 'sync-members') {
            const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
            if ((typeof body.group_id !== 'string' && !Number.isSafeInteger(body.group_id)) || String(body.group_id).length === 0) throw Object.assign(new Error('group_id is required'), { code: 'VALIDATION_ERROR' });
            return respond(res, 200, await contactSync.syncMembers(account, String(body.group_id)));
          }
          if (req.method === 'GET' && operation === 'search') {
            const term=url.searchParams.get('q')??'';const limit=Number(url.searchParams.get('limit')??50);
            if(term.length>200||!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Invalid contact search query or limit'),{code:'VALIDATION_ERROR'});
            return respond(res,200,await contactsStore.search(account.id,term,limit));
          }
          if (req.method === 'GET' && (operation === 'friends' || operation === 'groups')) {
            const limit = Number(url.searchParams.get('limit') ?? 50);
            if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('Invalid limit'), { code: 'VALIDATION_ERROR' });
            const cursor = url.searchParams.get('cursor');
            return respond(res, 200, operation === 'friends' ? await contactSync.pageFriends(account.id, cursor, limit) : await contactSync.pageGroups(account.id, cursor, limit));
          }
          if (req.method === 'GET' && (operation === 'members' || !operation)) return respond(res, 200, await contactsStore.get(account.id));
          return respond(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported contacts operation', retryable: false } });
        } catch (error) {
          return respond(res, 400, { error: { code: error instanceof Error && 'code' in error ? String((error as Error & { code: string }).code) : 'CONTACT_SYNC_FAILED', message: error instanceof Error ? error.message : 'Contact sync failed', retryable: false } });
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/accounts'){if(!safeTokenEqual(config.apiToken,bearer(req)))return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});return respond(res,200,{accounts:config.accounts.map(({access_token:_secret,...a})=>({...a,access_token_configured:Boolean(_secret)}))});}
      if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
        if (!safeTokenEqual(config.apiToken,bearer(req))) return respond(res,401,{error:{code:'AUTHENTICATION_ERROR',message:'Unauthorized',retryable:false}});
        const limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('offset')??0);
        if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)return respond(res,400,{error:{code:'VALIDATION_ERROR',message:'Invalid audit pagination',retryable:false}});
        if(!pool)return respond(res,503,{error:{code:'AUDIT_UNAVAILABLE',message:'Persistent audit is unavailable in memory mode',retryable:false}});
        const result=await pool.query('SELECT id,actor,action,account_id,conversation_id,message_id,target_type,target_id,result,metadata,created_at FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2',[limit,offset]);
        return respond(res,200,{events:result.rows,limit,offset,has_more:result.rows.length===limit});
      }
      if (req.method === 'GET' && url.pathname === '/api/summary') {
        if (config.apiToken && !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const accountId = url.searchParams.get('account_id') ?? undefined;
        if (accountId && !accountById(config, accountId)) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown account', retryable: false } });
        const summary = await store.summary(accountId, url.searchParams.get('since') ?? undefined);
        const connections = [...peers.values()].map(peer => ({ account_id: peer.account.id, connected: peer.socket.readyState === WebSocket.OPEN, connected_at: new Date(peer.connectedAt).toISOString() }));
        return respond(res, 200, { ...summary, accounts: config.accounts.map(({ access_token: _secret, ...account }) => ({ ...account, connected: connections.some(connection => connection.account_id === account.id && connection.connected) })), connections, uptime_seconds: Math.floor(process.uptime()), database: pool ? 'connected' : 'not_configured', counters: { ingested: eventCount, duplicates: duplicateCount, sends_succeeded: sendSuccess, sends_failed: sendFailure } });
      }
      if (req.method === 'POST' && url.pathname === '/api/messages/mark_seen_all') {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const updated = await store.markAllSeen();
        return respond(res, 200, { updated, scope: 'all incoming messages', qq_read: false, processed: false });
      }
      if (req.method === 'POST' && (url.pathname === '/api/messages/mark_processed' || url.pathname === '/api/messages/dismiss')) {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
        const id = typeof body.message_id === 'string' ? body.message_id : '';
        if (!id) return respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'message_id is required', retryable: false } });
        const state = url.pathname.endsWith('/dismiss') ? await store.dismiss(id) : await store.markProcessed(id);
        if(auditStore)await auditStore.record({actor:'admin',action:url.pathname.endsWith('/dismiss')?'message.dismiss':'message.process',message_id:id,target_type:'message',target_id:id,result:state?'success':'failure'});
        return state ? respond(res, 200, { state }) : respond(res, 404, { error: { code: 'MESSAGE_NOT_FOUND', message: 'Unknown message', retryable: false } });
      }
  if (req.method === 'POST' && url.pathname === '/api/messages/revoke') {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
        const account = accountById(config, String(body.account_id ?? ''));
        if (!account) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Explicit enabled account is required', retryable: false } });
        if (account.permission !== 'direct') { if(auditStore)await auditStore.record({actor:'admin',action:'message.revoke',account_id:account.id,target_type:'message',target_id:String(body.message_id??''),result:'failure',metadata:{code:'PERMISSION_DENIED'}});return respond(res, 403, { error: { code: 'PERMISSION_DENIED', message: `Account permission is ${account.permission}`, retryable: false } }); }
        const rawId = body.message_id;
        const messageId = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^-?\d+$/.test(rawId) ? Number(rawId) : NaN;
        if (!Number.isSafeInteger(messageId) || messageId < -2147483648 || messageId > 2147483647) return respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'message_id must be a OneBot v11 int32', retryable: false } });
        const known = (await store.list(account.id, 200)).find(m => m.direction === 'outgoing' && m.external_message_id === String(messageId));
        if (!known) return respond(res, 404, { error: { code: 'MESSAGE_NOT_FOUND', message: 'Only known outgoing messages can be revoked', retryable: false } });
        const peer = peers.get(account.id);
        if (!peer || peer.socket.readyState !== WebSocket.OPEN) {
          if(auditStore)await auditStore.record({actor:'admin',action:'message.revoke',account_id:account.id,message_id:known.id,target_type:'message',target_id:String(messageId),result:'failure',metadata:{code:'TRANSPORT_UNAVAILABLE'}});
          return respond(res, 503, { error: { code: 'TRANSPORT_UNAVAILABLE', message: 'No connected Reverse WS peer', retryable: true } });
        }
        try {
          const response = await callWsAction(peer, 'delete_msg', { message_id: messageId }, 15000);
          if(auditStore)await auditStore.record({actor:'admin',action:'message.revoke',account_id:account.id,message_id:known.id,target_type:'message',target_id:String(messageId),result:'success'});
          return respond(res, 200, { status: 'success', action: 'delete_msg', provider_response: response });
        } catch (error) {
          const details = error instanceof Error && 'providerResponse' in error ? (error as Error & { providerResponse: unknown }).providerResponse : undefined;
          if(auditStore)await auditStore.record({actor:'admin',action:'message.revoke',account_id:account.id,message_id:known.id,target_type:'message',target_id:String(messageId),result:'failure',metadata:{code:'ACTION_FAILED'}});
          return respond(res, 502, { status: 'failed', error: { code: 'ACTION_FAILED', message: error instanceof Error ? error.message : 'Action failed', retryable: false, ...(details === undefined ? {} : { details }) } });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/messages/send') {
        if (!config.apiToken || !safeTokenEqual(config.apiToken, bearer(req))) return respond(res, 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized', retryable: false } });
        const body = await readBody(req, config.maxMessageBytes) as Record<string, unknown>;
        const account = accountById(config, String(body.account_id ?? ''));
        if (!account) return respond(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: 'Explicit enabled account is required', retryable: false } });
        if (account.permission !== 'direct') { if(auditStore)await auditStore.record({actor:'admin',action:'message.send',account_id:account.id,target_type:String(body.message_type??''),target_id:typeof body.target_id==='string'?body.target_id:null,result:'failure',metadata:{code:'PERMISSION_DENIED'}});return respond(res, 403, { error: { code: 'PERMISSION_DENIED', message: `Account permission is ${account.permission}`, retryable: false } }); }
        const clientRequestId = typeof body.client_request_id === 'string' ? body.client_request_id : '';
        const target = String(body.target_id ?? ''); const type = body.message_type;
        if (!clientRequestId || !target || (type !== 'private' && type !== 'group') || (typeof body.message !== 'string' && !Array.isArray(body.message))) return respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Explicit client_request_id, target_id, message_type and message are required', retryable: false } });
        try {
          if (pool) {
            const outgoing = await onebot.sendMessage(account, type, target, body.message as string | import('./normalize.js').Segment[], clientRequestId);
            sendSuccess++;
            if(auditStore)await auditStore.record({actor:'admin',action:'message.send',account_id:account.id,message_id:outgoing.id,target_type:type,target_id:target,result:'success'});
            return respond(res, 200, { status: 'sent', message: outgoing });
          }
          const existing = (await store.list(account.id, 200)).find(m => m.client_request_id === clientRequestId);
          if (existing) return respond(res, 200, { status: 'duplicate', message: existing });
          const outgoing = await onebot.sendMessage(account, type, target, body.message as string | import('./normalize.js').Segment[], clientRequestId);
          sendSuccess++;
          if(auditStore)await auditStore.record({actor:'admin',action:'message.send',account_id:account.id,message_id:outgoing.id,target_type:type,target_id:target,result:'success'});
          return respond(res, 200, { status: 'sent', message: outgoing });
        } catch (error) { sendFailure++; const code = (error as { code?: string }).code;if(auditStore)await auditStore.record({actor:'admin',action:'message.send',account_id:account.id,target_type:type as string,target_id:target,result:'failure',metadata:{code:code??'ACTION_FAILED'}}); if(code==='IDEMPOTENCY_CONFLICT')return respond(res,409,{error:{code,message:error instanceof Error?error.message:'Idempotency conflict',retryable:false}}); if(code==='IDEMPOTENCY_IN_PROGRESS')return respond(res,409,{error:{code,message:error instanceof Error?error.message:'Send is pending or uncertain; do not retry automatically',retryable:false}}); return respond(res, code === 'TRANSPORT_UNAVAILABLE' ? 503 : 502, { error: { code: code ?? 'ACTION_FAILED', message: error instanceof Error ? error.message : 'Action failed', retryable: pool ? false : code !== 'ACTION_REJECTED' } }); }
      }
      return respond(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found', retryable: false } });
    } catch (error) {
      const code = error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : error instanceof SyntaxError || error instanceof Error && error.message.startsWith('Invalid ') || error instanceof Error && error.message.includes('required') ? 400 : 500;
      logger.warn({ error: error instanceof Error ? error.message : 'unknown', path: url.pathname }, 'request failed');
      return respond(res, code, { error: { code: code === 413 ? 'PAYLOAD_TOO_LARGE' : code === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: code === 500 ? 'Request failed' : 'Invalid request', retryable: code === 500 } });
    }
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const mcp = createMcpService(config, store, contactsStore);
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
      const message = normalized ? applyPriority(normalized, activePriorityConfig) : null;
      if (!message) return;
      const result = await store.insert(message); eventCount++; if (!result.inserted) duplicateCount++;
      if(result.inserted&&auditStore)void auditStore.record({actor:'onebot',action:'message.ingest',account_id:account.id,message_id:result.message.id,target_type:'message',target_id:result.message.id,result:'success'}).catch(error=>logger.warn({account_id:account.id,error:error instanceof Error?error.message:'audit failed'},'message audit write failed'));
      if(pool)await notificationQueue!.enqueue({event:'message.received',accountId:account.id,messageId:result.message.id,dedupeKey:`message.received:${account.id}:${result.message.id}`});
    });
    socket.on('close', () => { if (peers.get(account.id) === peer) peers.delete(account.id); for (const [key, resolve] of peer.pending) { peer.pending.delete(key); resolve({ error: 'disconnected' }); } logger.warn({ account_id: account.id }, 'OneBot transport disconnected'); });
    socket.on('error', (err: Error) => logger.warn({ account_id: account.id, error: err.message }, 'OneBot socket error'));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  logger.info({ host: config.host, port: config.port, accounts: config.accounts.length }, 'Agent OneBot Inbox API started');
  return { store, peers, accounts: config.accounts,address:()=>{const value=server.address();return value&&typeof value==='object'?value:null}, close: async () => { await notificationWorker?.stop(); for (const peer of peers.values()) peer.socket.close(); wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); if (pool) await pool.end(); } };
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
