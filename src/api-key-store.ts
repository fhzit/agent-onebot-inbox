import { createHash, randomBytes } from 'node:crypto';

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type ApiKeyStore = {
  create(name: string): Promise<{ record: ApiKeyRecord; key: string }>;
  list(): Promise<ApiKeyRecord[]>;
  revoke(id: string): Promise<boolean>;
  /** Returns the matching key id when the presented secret is active. */
  verify(secret: string): Promise<string | null>;
};

const hashKey = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const newId = (): string => randomBytes(8).toString('hex');
/** 32 random bytes, url-safe; the hash is what we persist. */
const newSecret = (): string => `aoi_${randomBytes(32).toString('base64url')}`;

const toRecord = (row: {
  id: string; name: string; prefix: string;
  created_at: Date | string; last_used_at: Date | string | null; revoked_at: Date | string | null;
}): ApiKeyRecord => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: new Date(row.created_at).toISOString(),
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
});

export class MemoryApiKeyStore implements ApiKeyStore {
  readonly #rows = new Map<string, { record: ApiKeyRecord; hash: string }>();

  async create(name: string): Promise<{ record: ApiKeyRecord; key: string }> {
    const key = newSecret();
    const record: ApiKeyRecord = {
      id: newId(),
      name,
      prefix: key.slice(0, 12),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.#rows.set(record.id, { record, hash: hashKey(key) });
    return { record, key };
  }

  async list(): Promise<ApiKeyRecord[]> {
    return [...this.#rows.values()].map(row => row.record).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revoke(id: string): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.record.revokedAt) return false;
    row.record = { ...row.record, revokedAt: new Date().toISOString() };
    return true;
  }

  async verify(secret: string): Promise<string | null> {
    const hash = hashKey(secret);
    for (const row of this.#rows.values()) {
      if (row.hash === hash && !row.record.revokedAt) {
        row.record = { ...row.record, lastUsedAt: new Date().toISOString() };
        return row.record.id;
      }
    }
    return null;
  }
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

export class PostgresApiKeyStore implements ApiKeyStore {
  constructor(private readonly db: Queryable) {}

  async create(name: string): Promise<{ record: ApiKeyRecord; key: string }> {
    const key = newSecret();
    const id = newId();
    const result = await this.db.query(
      `INSERT INTO api_keys(id,name,key_hash,prefix) VALUES($1,$2,$3,$4) RETURNING id,name,prefix,created_at,last_used_at,revoked_at`,
      [id, name, hashKey(key), key.slice(0, 12)],
    );
    return { record: toRecord(result.rows[0] as Parameters<typeof toRecord>[0]), key };
  }

  async list(): Promise<ApiKeyRecord[]> {
    const result = await this.db.query(
      `SELECT id,name,prefix,created_at,last_used_at,revoked_at FROM api_keys ORDER BY created_at DESC LIMIT 200`,
    );
    return result.rows.map(row => toRecord(row as Parameters<typeof toRecord>[0]));
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async verify(secret: string): Promise<string | null> {
    const hash = hashKey(secret);
    const result = await this.db.query(
      `UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1 AND revoked_at IS NULL RETURNING id`,
      [hash],
    );
    const row = result.rows[0] as { id?: string } | undefined;
    return row?.id ?? null;
  }
}
