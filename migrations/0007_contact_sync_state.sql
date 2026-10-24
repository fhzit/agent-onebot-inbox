ALTER TABLE watch_groups ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global';
ALTER TABLE watch_groups ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS contact_sync_state (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('friends','groups','members')),
  group_id text NOT NULL DEFAULT '',
  synced_at timestamptz NOT NULL DEFAULT now(),
  item_count integer NOT NULL DEFAULT 0 CHECK(item_count>=0),
  PRIMARY KEY(account_id,kind,group_id)
);
