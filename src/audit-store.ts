export type AuditEntry={actor:string;action:string;account_id?:string|null;conversation_id?:string|null;message_id?:string|null;target_type?:string|null;target_id?:string|null;result:'success'|'failure';metadata?:Record<string,unknown>};
export interface AuditStore{record(entry:AuditEntry):Promise<void>;}
export class PostgresAuditStore implements AuditStore{
 constructor(private readonly db:{query(text:string,values?:unknown[]):Promise<unknown>}){}
 async record(entry:AuditEntry){await this.db.query('INSERT INTO audit_logs(actor,action,account_id,conversation_id,message_id,target_type,target_id,result,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[entry.actor,entry.action,entry.account_id??null,entry.conversation_id??null,entry.message_id??null,entry.target_type??null,entry.target_id??null,entry.result,JSON.stringify(entry.metadata??{})]);}
}
