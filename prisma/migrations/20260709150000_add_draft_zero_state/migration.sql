-- Draft Zero: a parallel fast path over grant prep sessions.
-- One nullable JSONB column stores the Draft Zero ledger (seed text, extracted
-- claims with provenance/source spans, generation metadata). The authoritative
-- point statuses continue to live in stage_states_json; the ledger only carries
-- Draft-Zero-specific provenance that the stage-state normalizers would strip.

ALTER TABLE "grant_prep_sessions"
  ADD COLUMN IF NOT EXISTS "draft_zero_state_json" JSONB;
