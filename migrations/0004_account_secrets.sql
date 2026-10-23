CREATE TABLE IF NOT EXISTS account_secrets (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_access_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
