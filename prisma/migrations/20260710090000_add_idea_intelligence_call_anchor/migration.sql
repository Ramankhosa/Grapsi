-- Idea Intelligence: allow anchoring an analysis to a specific funding call
-- and back-linking a session to the Grant Prep session it was handed off to.

ALTER TABLE "idea_intelligence_runs"
  ADD COLUMN IF NOT EXISTS "anchor_funding_call_id" TEXT;

ALTER TABLE "idea_intelligence_sessions"
  ADD COLUMN IF NOT EXISTS "anchor_funding_call_id" TEXT,
  ADD COLUMN IF NOT EXISTS "linked_grant_prep_session_id" TEXT;

CREATE INDEX IF NOT EXISTS "idea_intelligence_runs_anchor_call_idx"
  ON "idea_intelligence_runs" ("anchor_funding_call_id");

CREATE INDEX IF NOT EXISTS "idea_intelligence_sessions_anchor_call_idx"
  ON "idea_intelligence_sessions" ("anchor_funding_call_id");

CREATE INDEX IF NOT EXISTS "idea_intelligence_sessions_linked_prep_idx"
  ON "idea_intelligence_sessions" ("linked_grant_prep_session_id");
