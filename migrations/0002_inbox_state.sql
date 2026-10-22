-- Durable agent-side inbox state. QQ/provider read status is never modified.
CREATE TABLE IF NOT EXISTS inbox_states (
  message_id text PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  seen_by_agent boolean NOT NULL DEFAULT false,
  processed boolean NOT NULL DEFAULT false,
  dismissed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_states_processed_idx ON inbox_states(processed) WHERE processed;
CREATE INDEX IF NOT EXISTS inbox_states_dismissed_idx ON inbox_states(dismissed) WHERE dismissed;
