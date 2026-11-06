-- Console-managed API keys: the admin panel mints and revokes them, the API
-- accepts them as bearer credentials. Only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_active_idx ON api_keys(revoked_at) WHERE revoked_at IS NULL;
