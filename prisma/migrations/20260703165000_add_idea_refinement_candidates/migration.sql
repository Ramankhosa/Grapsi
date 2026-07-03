CREATE TABLE IF NOT EXISTS "idea_refinement_candidates" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "session_id" TEXT,
  "candidate_index" INTEGER NOT NULL,
  "objective" TEXT,
  "strategy" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "idea_text" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "groundedness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "selected_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "idea_refinement_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idea_refinement_candidates_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "idea_intelligence_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "idea_refinement_candidates_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "idea_intelligence_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idea_refinement_candidates_run_index_idx"
  ON "idea_refinement_candidates"("run_id", "candidate_index");

CREATE INDEX IF NOT EXISTS "idea_refinement_candidates_run_status_idx"
  ON "idea_refinement_candidates"("run_id", "status");

CREATE INDEX IF NOT EXISTS "idea_refinement_candidates_session_created_idx"
  ON "idea_refinement_candidates"("session_id", "created_at");

CREATE INDEX IF NOT EXISTS "idea_refinement_candidates_selected_version_idx"
  ON "idea_refinement_candidates"("selected_version_id");
