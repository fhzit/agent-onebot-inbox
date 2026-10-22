export type AccountConfig = {
  id: string;
  alias: string;
  self_id: string;
  provider: 'napcat' | 'snowluma' | string;
  enabled: boolean;
  access_token?: string;
  action_url?: string;
  permission: 'readonly' | 'confirm' | 'direct';
};

export type AppConfig = {
  host: string;
  port: number;
  apiToken: string;
  maxMessageBytes: number;
  logMessageContent: boolean;
  accounts: AccountConfig[];
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(env.ACCOUNTS_JSON ?? '[]');
  } catch {
    throw new Error('ACCOUNTS_JSON must be valid JSON');
  }
  if (!Array.isArray(raw)) throw new Error('ACCOUNTS_JSON must be an array');
  const ids = new Set<string>();
  const selfIds = new Set<string>();
  const accounts: AccountConfig[] = raw.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Each account must be an object');
    const a = item as Record<string, unknown>;
    for (const field of ['id', 'alias', 'self_id', 'provider'] as const) {
      if (typeof a[field] !== 'string' || !a[field]) throw new Error(`Account ${field} is required`);
    }
    const id = a.id as string;
    const selfId = a.self_id as string;
    if (ids.has(id)) throw new Error(`Duplicate account id: ${id}`);
    if (selfIds.has(selfId)) throw new Error(`Duplicate self_id: ${selfId}`);
    ids.add(id); selfIds.add(selfId);
    const permission = (a.permission ?? env.PERMISSIONS_DEFAULT ?? 'readonly') as string;
    if (!['readonly', 'confirm', 'direct'].includes(permission)) throw new Error(`Invalid permission for ${id}`);
    return {
      id, alias: a.alias as string, self_id: selfId, provider: a.provider as string,
      enabled: a.enabled !== false, permission: permission as AccountConfig['permission'],
      ...(typeof a.access_token === 'string' ? { access_token: a.access_token } : {}),
      ...(typeof a.action_url === 'string' ? { action_url: a.action_url } : {}),
    };
  });
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    apiToken: env.API_TOKEN ?? '',
    maxMessageBytes: Number(env.MAX_MESSAGE_BYTES ?? 262144),
    logMessageContent: parseBool(env.LOG_MESSAGE_CONTENT, false),
    accounts,
  };
}
