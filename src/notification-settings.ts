import type { Pool } from 'pg';
import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
export type NotificationSettings = {
 enabled:boolean; webhookUrl:string; webhookSecret:string; minPriority:'P0'|'P1'|'P2'|'P3'|'P4'; includePreview:boolean; timeoutMs:number; maxAttempts:number;
};
export type NotificationConfigStore={get():Promise<NotificationSettings>;put(value:NotificationSettings):Promise<void>};
export const defaultNotificationSettings:NotificationSettings={enabled:false,webhookUrl:'',webhookSecret:'',minPriority:'P1',includePreview:false,timeoutMs:5000,maxAttempts:3};
export class MemoryNotificationConfigStore implements NotificationConfigStore{
 private value=structuredClone(defaultNotificationSettings);
 async get(){return {...this.value,webhookSecret:this.value.webhookSecret};}
 async put(value:NotificationSettings){this.value=structuredClone(value);}
}
export class PostgresNotificationConfigStore implements NotificationConfigStore{
 private key:Buffer;
 constructor(private pool:Pool,masterKey:string){this.key=Buffer.from(masterKey,'base64');if(this.key.length!==32)throw new Error('ACCOUNT_ENCRYPTION_KEY must be base64-encoded 32 bytes');}
 private encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join(':');}
 private decrypt(value:string){const [iv,tag,data]=value.split(':');if(!iv||!tag||!data)throw new Error('Invalid encrypted webhook secret');const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');}
 async get(){const result=await this.pool.query<{value:unknown}>('SELECT value FROM app_settings WHERE key=$1',['notification']);const value=object(result.rows[0]?.value);const encrypted=string(value.webhookSecret);return{enabled:value.enabled===true,webhookUrl:string(value.webhookUrl),webhookSecret:encrypted?this.decrypt(encrypted):'',minPriority:priority(value.minPriority),includePreview:value.includePreview===true,timeoutMs:number(value.timeoutMs,5000),maxAttempts:number(value.maxAttempts,3)};}
 async put(value:NotificationSettings){await this.pool.query('INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',['notification',JSON.stringify({...value,webhookSecret:value.webhookSecret?this.encrypt(value.webhookSecret):''})]);}
}
function object(v:unknown):Record<string,unknown>{if(v&&typeof v==='object'&&!Array.isArray(v))return v as Record<string,unknown>;if(typeof v==='string'){try{const x:unknown=JSON.parse(v);return x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};}catch{return{};}}return{};}
function string(v:unknown):string{return typeof v==='string'?v:'';}
function number(v:unknown,fallback:number):number{return typeof v==='number'&&Number.isFinite(v)?v:fallback;}
function priority(v:unknown):NotificationSettings['minPriority']{return ['P0','P1','P2','P3','P4'].includes(String(v))?v as NotificationSettings['minPriority']:'P1';}
