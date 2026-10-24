-- Additive sidecar tables. No existing crawler task or catalogue row is changed.
CREATE TABLE IF NOT EXISTS monitor_local_workers (
  id text PRIMARY KEY,
  display_name varchar(120) NOT NULL,
  app_version varchar(40) NOT NULL,
  model_sha256 varchar(64) NOT NULL,
  state varchar(30) NOT NULL DEFAULT 'IDLE',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS monitor_local_analysis_jobs (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES monitor_resources(id) ON DELETE CASCADE,
  version_id text NOT NULL REFERENCES monitor_resource_versions(id) ON DELETE CASCADE,
  policy_hash varchar(64) NOT NULL,
  input_hash varchar(64) NOT NULL,
  payload jsonb NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'QUEUED',
  attempts integer NOT NULL DEFAULT 0,
  owner text REFERENCES monitor_local_workers(id),
  lease_token text,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id, policy_hash),
  CHECK (state IN ('QUEUED','RUNNING','DONE','FAILED','SUPERSEDED'))
);
CREATE INDEX IF NOT EXISTS monitor_local_jobs_claim ON monitor_local_analysis_jobs(state,available_at,created_at);
CREATE TABLE IF NOT EXISTS monitor_local_analysis_results (
  job_id text PRIMARY KEY REFERENCES monitor_local_analysis_jobs(id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES monitor_resources(id) ON DELETE CASCADE,
  version_id text NOT NULL REFERENCES monitor_resource_versions(id) ON DELETE CASCADE,
  worker_id text NOT NULL REFERENCES monitor_local_workers(id),
  input_hash varchar(64) NOT NULL,
  policy_hash varchar(64) NOT NULL,
  model_sha256 varchar(64) NOT NULL,
  decision varchar(16) NOT NULL CHECK (decision IN ('CALL','RELATED','GENERAL','UNSURE')),
  elapsed_ms integer NOT NULL,
  mode varchar(16) NOT NULL DEFAULT 'SHADOW' CHECK (mode='SHADOW'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_local_results_resource ON monitor_local_analysis_results(resource_id,created_at DESC);
