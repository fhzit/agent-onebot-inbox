import type { PriorityConfig, PriorityRule, WatchPerson } from './priority.js';
import type { Pool } from 'pg';

export type PriorityStore = {
  list(): Promise<PriorityConfig>;
  putRule(rule: PriorityRule): Promise<void>;
  deleteRule(id: string): Promise<boolean>;
  putWatchPerson(person: WatchPerson & { id: string; displayName: string; enabled: boolean }): Promise<void>;
  deleteWatchPerson(id: string): Promise<boolean>;
};

export class MemoryPriorityStore implements PriorityStore {
  private rules = new Map<string, PriorityRule>();
  private people = new Map<string, WatchPerson & { id: string; displayName: string; enabled: boolean }>();
  async list(): Promise<PriorityConfig> {
    return {
      rules: [...this.rules.values()].filter(rule => (rule as PriorityRule & { enabled?: boolean }).enabled !== false),
      watchPeople: [...this.people.values()].filter(person => person.enabled).map(({ userId, boost, accountIds }) => ({ userId, boost, ...(accountIds ? { accountIds } : {}) })),
    };
  }
  async putRule(rule: PriorityRule): Promise<void> { this.rules.set(rule.id, structuredClone(rule)); }
  async deleteRule(id: string): Promise<boolean> { return this.rules.delete(id); }
  async putWatchPerson(person: WatchPerson & { id: string; displayName: string; enabled: boolean }): Promise<void> { this.people.set(person.id, structuredClone(person)); }
  async deleteWatchPerson(id: string): Promise<boolean> { return this.people.delete(id); }
}

export class PostgresPriorityStore implements PriorityStore {
  constructor(private readonly pool: Pool) {}
  async list(): Promise<PriorityConfig> {
    const rules = await this.pool.query<{id:string;enabled:boolean;account_scope:unknown;conditions:unknown;actions:unknown;order_index:number}>('SELECT id,enabled,account_scope,conditions,actions,order_index FROM priority_rules ORDER BY order_index,id');
    const people = await this.pool.query<{id:string;qq_id:string|null;display_name:string;enabled:boolean;priority_boost:number;account_scope:unknown}>('SELECT id,qq_id,display_name,enabled,priority_boost,account_scope FROM watch_people ORDER BY display_name,id');
    return {
      rules: rules.rows.filter(row => row.enabled).map(row => {
        const scope = jsonObject(row.account_scope);
        const conditions = jsonObject(row.conditions);
        const actions = jsonObject(row.actions);
        return {
          id: row.id,
          kind: actions.kind === 'hard' ? 'hard' : 'weighted',
          weight: typeof actions.weight === 'number' ? actions.weight : 0,
          ...(isPriority(actions.priority) ? { priority: actions.priority } : {}),
          ...((Array.isArray(scope.accountIds) && scope.accountIds.every(x => typeof x === 'string')) ? { accountIds: scope.accountIds as string[] } : {}),
          ...(Array.isArray(conditions.keywords) && conditions.keywords.every(x => typeof x === 'string') ? { keywords: conditions.keywords as string[] } : {}),
          ...(Array.isArray(conditions.conversationTypes) && conditions.conversationTypes.every(x => x === 'private' || x === 'group') ? { conversationTypes: conditions.conversationTypes as Array<'private'|'group'> } : {}),
          ...(Array.isArray(conditions.groupIds) && conditions.groupIds.every(x => typeof x === 'string') ? { groupIds: conditions.groupIds as string[] } : {}),
          ...(Array.isArray(conditions.senderIds) && conditions.senderIds.every(x => typeof x === 'string') ? { senderIds: conditions.senderIds as string[] } : {}),
          ...(conditions.atMe === true ? { atMe: true } : {}),
        };
      }),
      watchPeople: people.rows.filter(row => row.enabled && row.qq_id).map(row => ({
        userId: row.qq_id!, boost: row.priority_boost,
        ...(Array.isArray(jsonObject(row.account_scope).accountIds) ? { accountIds: jsonObject(row.account_scope).accountIds as string[] } : {}),
      })),
    };
  }
  async putRule(rule: PriorityRule): Promise<void> {
    await this.pool.query(`INSERT INTO priority_rules(id,name,enabled,account_scope,order_index,conditions,actions)
      VALUES($1,$2,true,$3::jsonb,$4,$5::jsonb,$6::jsonb)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,enabled=true,account_scope=EXCLUDED.account_scope,order_index=EXCLUDED.order_index,conditions=EXCLUDED.conditions,actions=EXCLUDED.actions,updated_at=now()`,
      [rule.id,rule.id,JSON.stringify({accountIds:rule.accountIds??[]}),0,JSON.stringify({keywords:rule.keywords??[],conversationTypes:rule.conversationTypes??[],groupIds:rule.groupIds??[],senderIds:rule.senderIds??[],atMe:rule.atMe??false}),JSON.stringify({kind:rule.kind??'weighted',weight:rule.weight??0,priority:rule.priority??null})]);
  }
  async deleteRule(id: string): Promise<boolean> { return (await this.pool.query('DELETE FROM priority_rules WHERE id=$1',[id])).rowCount===1; }
  async putWatchPerson(person: WatchPerson & { id: string; displayName: string; enabled: boolean }): Promise<void> {
    await this.pool.query(`INSERT INTO watch_people(id,account_scope,qq_id,display_name,enabled,priority_boost)
      VALUES($1,$2::jsonb,$3,$4,$5,$6)
      ON CONFLICT(id) DO UPDATE SET account_scope=EXCLUDED.account_scope,qq_id=EXCLUDED.qq_id,display_name=EXCLUDED.display_name,enabled=EXCLUDED.enabled,priority_boost=EXCLUDED.priority_boost,updated_at=now()`,
      [person.id,JSON.stringify({accountIds:person.accountIds??[]}),person.userId,person.displayName,person.enabled,person.boost]);
  }
  async deleteWatchPerson(id: string): Promise<boolean> { return (await this.pool.query('DELETE FROM watch_people WHERE id=$1',[id])).rowCount===1; }
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') { try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {}; } catch { return {}; } }
  return {};
}
function isPriority(value: unknown): value is 'P0'|'P1'|'P2'|'P3'|'P4' { return value==='P0'||value==='P1'||value==='P2'||value==='P3'||value==='P4'; }
