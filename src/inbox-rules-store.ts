import type { Pool } from 'pg';
import type { InboxRule } from './inbox-rules.js';

export type InboxRulesStore = { get(): Promise<InboxRule[]>; put(rules: readonly InboxRule[]): Promise<void> };
export class MemoryInboxRulesStore implements InboxRulesStore {
  private rules: InboxRule[] = [];
  async get(): Promise<InboxRule[]> { return structuredClone(this.rules); }
  async put(rules: readonly InboxRule[]): Promise<void> { this.rules = structuredClone([...rules]); }
}
export class PostgresInboxRulesStore implements InboxRulesStore {
  constructor(private pool: Pool) {}
  async get(): Promise<InboxRule[]> {
    const result = await this.pool.query<{ value: unknown }>('SELECT value FROM app_settings WHERE key=$1', ['inbox_rules']);
    const value = result.rows[0]?.value;
    if (Array.isArray(value)) return value as InboxRule[];
    if (typeof value === 'string') { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed as InboxRule[] : []; } catch { return []; } }
    return [];
  }
  async put(rules: readonly InboxRule[]): Promise<void> {
    await this.pool.query('INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()', ['inbox_rules', JSON.stringify(rules)]);
  }
}
