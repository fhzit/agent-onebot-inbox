CREATE TABLE IF NOT EXISTS outbound_idempotency (
  account_id text NOT NULL,
  client_request_id text NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('private','group')),
  target_id text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','complete')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, client_request_id)
);
