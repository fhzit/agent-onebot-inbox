CREATE TABLE provider_qualification_results (
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9._-]*$'),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 128),
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, version)
);

REVOKE ALL ON provider_qualification_results FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON provider_qualification_results TO aoi_app;
