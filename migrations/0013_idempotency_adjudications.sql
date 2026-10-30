CREATE TABLE IF NOT EXISTS outbound_idempotency_adjudications (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL,
  client_request_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('sent','not-sent','unresolved')),
  note text NOT NULL CHECK (length(note) <= 1000),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, client_request_id)
    REFERENCES outbound_idempotency(account_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS outbound_idempotency_adjudications_lookup
  ON outbound_idempotency_adjudications(account_id, client_request_id, created_at, id);
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE outbound_idempotency_adjudications FROM aoi_app;
GRANT SELECT, INSERT ON TABLE outbound_idempotency_adjudications TO aoi_app;
GRANT USAGE, SELECT ON SEQUENCE outbound_idempotency_adjudications_id_seq TO aoi_app;
