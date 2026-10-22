CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), alias text NOT NULL, self_id text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true, is_default boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_default_idx ON accounts (is_default) WHERE is_default;
CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type text NOT NULL, name text NOT NULL, enabled boolean NOT NULL DEFAULT true, capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb, last_connected_at timestamptz, last_disconnected_at timestamptz,
  last_event_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  type text NOT NULL, direction text NOT NULL, endpoint text, status text NOT NULL DEFAULT 'disconnected',
  last_heartbeat_at timestamptz, last_event_at timestamptz, connected_at timestamptz, disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('private','group')), external_id text NOT NULL, name text,
  group_id text, peer_user_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,type,external_id)
);
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  qq_id text NOT NULL, nickname text, remark text, avatar text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,qq_id)
);
CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, qq_id text NOT NULL,
  nickname text, card text, role text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, last_synced_at timestamptz,
  UNIQUE(conversation_id,qq_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  provider_id uuid REFERENCES providers(id) ON DELETE SET NULL, transport_id uuid REFERENCES transports(id) ON DELETE SET NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK(direction IN ('incoming','outgoing')), external_message_id text,
  client_request_id text, event_fingerprint text NOT NULL, sender_id text NOT NULL, sender_name text, sender_card text,
  plain_text text NOT NULL DEFAULT '', raw_message jsonb, reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  reply_to_external_id text, at_me boolean NOT NULL DEFAULT false, at_all boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'P2', priority_score smallint NOT NULL DEFAULT 35 CHECK(priority_score BETWEEN 0 AND 100),
  requires_reply boolean NOT NULL DEFAULT false, urgent boolean NOT NULL DEFAULT false, deadline timestamptz,
  sent_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), recall_status text,
  recalled_at timestamptz, raw_event jsonb NOT NULL DEFAULT '{}'::jsonb, provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,client_request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_external_id_idx ON messages(account_id,provider_id,external_message_id) WHERE external_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_fingerprint_idx ON messages(account_id,event_fingerprint) WHERE direction='incoming';
CREATE INDEX IF NOT EXISTS messages_conversation_time_idx ON messages(conversation_id,sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_account_time_idx ON messages(account_id,sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_time_idx ON messages(account_id,sender_id,sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_priority_time_idx ON messages(priority,sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_at_me_time_idx ON messages(at_me,sent_at DESC) WHERE at_me;
CREATE INDEX IF NOT EXISTS messages_reply_time_idx ON messages(requires_reply,sent_at DESC) WHERE requires_reply;
CREATE INDEX IF NOT EXISTS messages_deadline_idx ON messages(deadline) WHERE deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_fts_idx ON messages USING gin(to_tsvector('simple', plain_text));
CREATE TABLE IF NOT EXISTS message_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  position integer NOT NULL, type text NOT NULL, data jsonb NOT NULL, UNIQUE(message_id,position)
);
CREATE TABLE IF NOT EXISTS inbox_states (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, unread boolean NOT NULL DEFAULT true,
  classified boolean NOT NULL DEFAULT false, summarized boolean NOT NULL DEFAULT false, notified boolean NOT NULL DEFAULT false,
  seen_by_agent boolean NOT NULL DEFAULT false, processed boolean NOT NULL DEFAULT false, dismissed boolean NOT NULL DEFAULT false,
  qq_read boolean NOT NULL DEFAULT false, first_seen_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, dismissed_at timestamptz
);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  provider_file_id text, type text NOT NULL, filename text NOT NULL, safe_filename text NOT NULL, size bigint, mime text,
  sha256 text, remote_reference text, local_path text, download_state text NOT NULL DEFAULT 'metadata_only',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), downloaded_at timestamptz
);
CREATE TABLE IF NOT EXISTS watch_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_scope jsonb NOT NULL, qq_id text, display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, scope text NOT NULL DEFAULT 'global', group_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority_boost integer NOT NULL DEFAULT 0, notify_mode text NOT NULL DEFAULT 'digest', keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS watch_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_scope jsonb NOT NULL, group_id text NOT NULL, name text,
  enabled boolean NOT NULL DEFAULT true, notify_mode text NOT NULL DEFAULT 'digest', priority_boost integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS priority_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  account_scope jsonb NOT NULL, order_index integer NOT NULL DEFAULT 0, conditions jsonb NOT NULL, actions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT, source text NOT NULL, model text,
  priority text NOT NULL, priority_score smallint NOT NULL CHECK(priority_score BETWEEN 0 AND 100), confidence real,
  reason text, summary text, requires_reply boolean NOT NULL DEFAULT false, urgent boolean NOT NULL DEFAULT false,
  deadline timestamptz, action_items jsonb NOT NULL DEFAULT '[]'::jsonb, raw_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  message_id uuid REFERENCES messages(id) ON DELETE RESTRICT, type text NOT NULL, priority text NOT NULL,
  channel text NOT NULL, dedupe_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'queued', attempt_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL, scheduled_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_scope jsonb NOT NULL, range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL, message_count integer NOT NULL, summary text, structured_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_id uuid REFERENCES messages(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS task_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  source_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT, title text NOT NULL, description text,
  due_at timestamptz, priority text NOT NULL DEFAULT 'P2', confidence real, status text NOT NULL DEFAULT 'candidate',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS message_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  message_id uuid REFERENCES messages(id) ON DELETE RESTRICT, action text NOT NULL, actor text NOT NULL,
  request_id text NOT NULL, request_payload jsonb NOT NULL DEFAULT '{}'::jsonb, response_payload jsonb,
  status text NOT NULL, error_code text, error_message text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(account_id,request_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, action text NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT, conversation_id uuid REFERENCES conversations(id) ON DELETE RESTRICT,
  message_id uuid REFERENCES messages(id) ON DELETE RESTRICT, target_type text, target_id text,
  result text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE, cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_at timestamptz, last_message_id text, last_message_time timestamptz, last_reconcile_at timestamptz,
  UNIQUE(account_id,conversation_id)
);
CREATE TABLE IF NOT EXISTS reconciliation_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  transport_id uuid REFERENCES transports(id) ON DELETE SET NULL, range_start timestamptz NOT NULL, range_end timestamptz,
  reason text NOT NULL, resolved boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, severity text NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL, message text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
