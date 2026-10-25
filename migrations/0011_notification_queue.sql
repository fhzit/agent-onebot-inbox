CREATE TABLE notification_queue (
  id bigserial PRIMARY KEY,
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 200),
  account_id text,
  message_id text,
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  last_error text CHECK (last_error IS NULL OR last_error IN ('Notification delivery failed') OR last_error ~ '^HTTP [1-5][0-9][0-9]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (status <> 'succeeded' OR lease_token IS NULL)
);
CREATE INDEX notification_queue_claim_idx ON notification_queue(run_after, id) WHERE status IN ('pending','processing');
REVOKE ALL ON notification_queue FROM PUBLIC;
REVOKE ALL ON SEQUENCE notification_queue_id_seq FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON notification_queue TO aoi_app;
GRANT USAGE, SELECT ON SEQUENCE notification_queue_id_seq TO aoi_app;
