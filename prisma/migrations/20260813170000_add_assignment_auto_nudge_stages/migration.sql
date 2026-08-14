-- Automatic deadline escalation.
--
-- Which nudges have already fired for an assignment. The array is both the
-- record and the lock: the sweep appends a stage with a guarded UPDATE
-- (`WHERE NOT (stage = ANY(auto_nudge_stages))`), so two overlapping hourly
-- runs cannot send the same reminder twice without needing a separate table.
ALTER TABLE "call_assignments"
  ADD COLUMN IF NOT EXISTS "auto_nudge_stages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The sweep scans open assignments with a deadline; this keeps that cheap as
-- the table grows.
CREATE INDEX IF NOT EXISTS idx_call_assignments_open_deadline
  ON "call_assignments" ("deadline_at")
  WHERE "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS');
