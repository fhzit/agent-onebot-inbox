-- Durable account-level consent state for AI advisory processing.
-- This records the current state (including the actor and disclosure accepted),
-- not message content or advisory payloads. Account deletion removes its consent.
CREATE TABLE ai_advisory_consent (
  account_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  actor text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  disclosure_version text NOT NULL CHECK (length(btrim(disclosure_version)) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- The migration runner's database role must be able to resolve aoi_app. This
-- migration intentionally fails rather than silently skipping ACL setup when it
-- is absent; provision the role before running migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aoi_app') THEN
    RAISE EXCEPTION 'migration 0015 requires PostgreSQL role aoi_app to exist';
  END IF;
END
$$;

-- The runtime needs SELECT/INSERT/UPDATE: revocation is represented as an
-- UPDATE (enabled=false), not a DELETE. These ACL changes remove direct grants
-- only. They do not restrict aoi_app if it owns the table, is superuser, or
-- inherits equivalent privileges through another role; apply migrations with
-- a trusted non-runtime owner and audit role memberships/ownership.
REVOKE ALL ON TABLE ai_advisory_consent FROM PUBLIC;
REVOKE ALL ON TABLE ai_advisory_consent FROM aoi_app;
GRANT SELECT, INSERT, UPDATE ON TABLE ai_advisory_consent TO aoi_app;
