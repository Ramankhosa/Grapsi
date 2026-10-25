ALTER TABLE monitor_local_analysis_results ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE monitor_local_analysis_results ADD COLUMN IF NOT EXISTS result_hash varchar(64);
CREATE TABLE IF NOT EXISTS monitor_processing_claims (
 input_key text PRIMARY KEY, owner text NOT NULL, lease_until timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_processing_claims_expiry ON monitor_processing_claims(lease_until);
