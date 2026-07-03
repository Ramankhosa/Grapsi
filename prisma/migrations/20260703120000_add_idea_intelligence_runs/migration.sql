CREATE TABLE IF NOT EXISTS "idea_intelligence_runs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "anchor_public_project_id" TEXT,
  "title" TEXT NOT NULL,
  "idea_text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "current_stage" INTEGER NOT NULL DEFAULT 0,
  "structured_idea_json" JSONB,
  "retrieval_results_json" JSONB,
  "analysis_json" JSONB,
  "scores_json" JSONB,
  "report_json" JSONB,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idea_intelligence_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idea_intelligence_runs_user_created_idx"
  ON "idea_intelligence_runs" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "idea_intelligence_runs_tenant_status_idx"
  ON "idea_intelligence_runs" ("tenant_id", "status");
