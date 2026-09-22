-- Origin-school provenance is copied from the intake event to the call.  The
-- name snapshot keeps reports intelligible after an organisation restructure.
ALTER TABLE funding_calls
  ADD COLUMN origin_school_id TEXT,
  ADD COLUMN origin_school_name TEXT,
  ADD COLUMN origin_school_source TEXT;

ALTER TABLE funding_import_jobs
  ADD COLUMN origin_school_id TEXT,
  ADD COLUMN origin_school_name TEXT,
  ADD COLUMN origin_school_source TEXT;

ALTER TABLE funding_intake_jobs
  ADD COLUMN origin_school_id TEXT,
  ADD COLUMN origin_school_name TEXT,
  ADD COLUMN origin_school_source TEXT;

ALTER TABLE funding_opportunity_matches
  ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN match_run_id TEXT,
  ADD COLUMN refreshed_at TIMESTAMP(3) NOT NULL DEFAULT now();

CREATE INDEX idx_funding_opportunity_matches_current_school
  ON funding_opportunity_matches(tenant_id, school_id, funding_call_id)
  WHERE is_current;

-- Existing rows are evidence, but not a certified current projection.  Fresh
-- matching runs will explicitly activate the rows they observed.
UPDATE funding_opportunity_matches SET is_current = false WHERE inferred = true;

-- Corrective actions have a visible acknowledgement step so the head can tell
-- an unseen instruction from one that is being worked.
ALTER TABLE dsr_actions DROP CONSTRAINT IF EXISTS dsr_actions_status_check;
ALTER TABLE dsr_actions
  ADD CONSTRAINT dsr_actions_status_check
  CHECK (status IN ('OPEN','ACKNOWLEDGED','DONE','CANCELLED'));
ALTER TABLE dsr_actions
  ADD COLUMN acknowledged_at TIMESTAMP(3),
  ADD COLUMN acknowledged_by_user_id TEXT REFERENCES users(id),
  ADD COLUMN resolution_note TEXT;
DROP INDEX IF EXISTS dsr_actions_one_next;
CREATE UNIQUE INDEX dsr_actions_one_next ON dsr_actions(
  tenant_id, school_id, COALESCE(application_id, 'call:' || call_id)
) WHERE is_next AND status IN ('OPEN','ACKNOWLEDGED');

-- Best-effort historical attribution.  It is deliberately labelled inferred,
-- never presented as an intake-time selection.
UPDATE funding_intake_jobs j
SET origin_school_id = unit.path[1],
    origin_school_name = school.name,
    origin_school_source = 'INFERRED_UPLOADER_PROFILE'
FROM researcher_profiles profile
JOIN tenant_org_units unit ON unit.id = profile.org_unit_id
JOIN tenant_org_units school ON school.id = unit.path[1]
WHERE profile.user_id = j.submitted_by_user_id
  AND j.origin_school_id IS NULL;

UPDATE funding_calls call
SET origin_school_id = job.origin_school_id,
    origin_school_name = job.origin_school_name,
    origin_school_source = job.origin_school_source
FROM funding_intake_jobs job
WHERE job.id = call.intake_job_id
  AND call.origin_school_id IS NULL
  AND job.origin_school_id IS NOT NULL;
