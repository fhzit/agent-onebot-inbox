-- PostgreSQL requires a UNIQUE/PRIMARY KEY covering the exact referenced columns
-- for a composite FK. The existing PK on messages(id) cannot serve as the target
-- for (account_id, id), even though id alone is unique. Keep this constraint so
-- the FK below declaratively enforces account ownership (rather than a racy trigger).
ALTER TABLE messages ADD CONSTRAINT messages_account_id_id_key UNIQUE (account_id, id);

-- Advisory payloads are deliberately limited to classification metadata; never persist
-- message text, model explanations/reasons, or provider payloads here.
CREATE TABLE ai_advisories (
  account_id text NOT NULL,
  message_id text NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 128),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 128),
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, message_id, policy_version),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id) ON DELETE CASCADE
);

-- Supports account-scoped newest-first reads and deterministic message-id tie-breaks.
CREATE INDEX ai_advisories_account_created_idx ON ai_advisories(account_id, created_at DESC, message_id DESC);
REVOKE ALL ON ai_advisories FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_advisories TO aoi_app;
