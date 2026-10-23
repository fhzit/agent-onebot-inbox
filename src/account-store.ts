import type { AccountConfig } from './config.js';
import type { Pool } from 'pg';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type AccountStore = {
 list():Promise<Array<Omit<AccountConfig,'access_token'>&{access_token_configured:boolean}>>;
 create(account:AccountConfig):Promise<void>;
 update(id:string,account:AccountConfig):Promise<boolean>;
 remove(id:string):Promise<boolean>;
};

export class MemoryAccountStore implements AccountStore {
 private accounts=new Map<string,AccountConfig>();
 async list(){return [...this.accounts.values()].map(({access_token,...a})=>({...a,access_token_configured:Boolean(access_token)}));}
 async create(a:AccountConfig){if(this.accounts.has(a.id)||[...this.accounts.values()].some(x=>x.self_id===a.self_id))throw new Error('Duplicate account id or self_id');this.accounts.set(a.id,structuredClone(a));}
 async update(id:string,a:AccountConfig){if(!this.accounts.has(id))return false;if([...this.accounts.values()].some(x=>x.id!==id&&x.self_id===a.self_id))throw new Error('Duplicate self_id');this.accounts.set(id,structuredClone(a));return true;}
 async remove(id:string){return this.accounts.delete(id);}
}

export class PostgresAccountStore implements AccountStore {
 private key:Buffer;
 constructor(private pool:Pool,masterKey:string){if(!masterKey)throw new Error('ACCOUNT_ENCRYPTION_KEY is required for managed account token persistence');this.key=Buffer.from(masterKey,'base64');if(this.key.length!==32)throw new Error('ACCOUNT_ENCRYPTION_KEY must be base64-encoded 32 bytes');}
 private encrypt(secret:string):string{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join(':');}
 private decrypt(value:string):string{const [iv,tag,data]=value.split(':');if(!iv||!tag||!data)throw new Error('Invalid encrypted account secret');const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');}
 async loadSecrets():Promise<Map<string,string>>{const result=await this.pool.query<{account_id:string;encrypted_access_token:string}>('SELECT account_id,encrypted_access_token FROM account_secrets');return new Map(result.rows.map(row=>[row.account_id,this.decrypt(row.encrypted_access_token)]));}
 async saveSecret(id:string,token:string):Promise<void>{await this.pool.query('INSERT INTO account_secrets(account_id,encrypted_access_token) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET encrypted_access_token=EXCLUDED.encrypted_access_token,updated_at=now()',[id,this.encrypt(token)]);}
 async deleteSecret(id:string):Promise<void>{await this.pool.query('DELETE FROM account_secrets WHERE account_id=$1',[id]);}
 async list(){const r=await this.pool.query<{id:string;alias:string;self_id:string;enabled:boolean;settings:unknown;secret_configured:boolean}>('SELECT a.id,a.alias,a.self_id,a.enabled,a.settings,(s.account_id IS NOT NULL) AS secret_configured FROM accounts a LEFT JOIN account_secrets s ON s.account_id=a.id ORDER BY a.created_at,a.id');return r.rows.map(a=>{const settings=jsonObj(a.settings);return{id:a.id,alias:a.alias,self_id:a.self_id,provider:String(settings.provider??'napcat'),enabled:a.enabled,permission:(settings.permission==='direct'||settings.permission==='confirm'?settings.permission:'readonly') as AccountConfig['permission'],...(typeof settings.action_url==='string'?{action_url:settings.action_url}:{}),access_token_configured:a.secret_configured};});}
 async create(a:AccountConfig){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('INSERT INTO accounts(id,alias,self_id,enabled,settings) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET alias=EXCLUDED.alias,self_id=EXCLUDED.self_id,enabled=EXCLUDED.enabled,settings=EXCLUDED.settings,updated_at=now()',[a.id,a.alias,a.self_id,a.enabled,JSON.stringify({provider:a.provider,permission:a.permission,action_url:a.action_url})]);await c.query('INSERT INTO providers(account_id,type,name,enabled,public_config) VALUES($1,$2,$3,$4,$5::jsonb)',[a.id,a.provider,a.alias,a.enabled,JSON.stringify({action_url:a.action_url??null,token_configured:Boolean(a.access_token)})]);if(a.access_token)await c.query('INSERT INTO account_secrets(account_id,encrypted_access_token) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET encrypted_access_token=EXCLUDED.encrypted_access_token,updated_at=now()',[a.id,this.encrypt(a.access_token)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async update(id:string,a:AccountConfig){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await c.query('UPDATE accounts SET alias=$2,self_id=$3,enabled=$4,settings=$5::jsonb,updated_at=now() WHERE id=$1',[id,a.alias,a.self_id,a.enabled,JSON.stringify({provider:a.provider,permission:a.permission,action_url:a.action_url})]);if(!r.rowCount){await c.query('ROLLBACK');return false;}const provider=await c.query('UPDATE providers SET type=$2,name=$3,enabled=$4,public_config=$5::jsonb,updated_at=now() WHERE account_id=$1',[id,a.provider,a.alias,a.enabled,JSON.stringify({action_url:a.action_url??null,token_configured:Boolean(a.access_token)})]);if(!provider.rowCount)await c.query('INSERT INTO providers(account_id,type,name,enabled,public_config) VALUES($1,$2,$3,$4,$5::jsonb)',[id,a.provider,a.alias,a.enabled,JSON.stringify({action_url:a.action_url??null,token_configured:Boolean(a.access_token)})]);if(a.access_token)await c.query('INSERT INTO account_secrets(account_id,encrypted_access_token) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET encrypted_access_token=EXCLUDED.encrypted_access_token,updated_at=now()',[id,this.encrypt(a.access_token)]);await c.query('COMMIT');return true;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async remove(id:string){const r=await this.pool.query('DELETE FROM accounts WHERE id=$1',[id]);return r.rowCount===1;}
}
function jsonObj(v:unknown):Record<string,unknown>{if(v&&typeof v==='object'&&!Array.isArray(v))return v as Record<string,unknown>;if(typeof v==='string'){try{const x:unknown=JSON.parse(v);return x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};}catch{return{};}}return{};}
