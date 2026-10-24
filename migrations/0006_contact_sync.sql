ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_type text NOT NULL DEFAULT 'friend';
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  qq_id text NOT NULL, contact_type text NOT NULL DEFAULT 'friend', nickname text, remark text, avatar text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,qq_id)
);
CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, qq_id text NOT NULL,
  nickname text, card text, role text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,qq_id)
);
