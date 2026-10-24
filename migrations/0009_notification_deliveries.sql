CREATE TABLE notification_deliveries (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  account_id text,
  message_id text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_created_at_idx ON notification_deliveries(created_at DESC, id DESC);
GRANT INSERT, SELECT ON notification_deliveries TO aoi_app;
GRANT USAGE, SELECT ON SEQUENCE notification_deliveries_id_seq TO aoi_app;
REVOKE UPDATE, DELETE, TRUNCATE ON notification_deliveries FROM aoi_app;
