ALTER TYPE "PublicProjectSourceKey" ADD VALUE IF NOT EXISTS 'ICSSR';
ALTER TYPE "PublicProjectSourceKey" ADD VALUE IF NOT EXISTS 'CSV_IMPORT';

ALTER TABLE "public_projects"
  ADD COLUMN IF NOT EXISTS "duplicate_of_id" TEXT,
  ADD COLUMN IF NOT EXISTS "deduped_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enriched_abstract" TEXT,
  ADD COLUMN IF NOT EXISTS "enrichment_source" TEXT,
  ADD COLUMN IF NOT EXISTS "enrichment_metadata_json" JSONB,
  ADD COLUMN IF NOT EXISTS "taxonomy_status" TEXT,
  ADD COLUMN IF NOT EXISTS "taxonomy_metadata_json" JSONB;

CREATE INDEX IF NOT EXISTS "public_projects_duplicate_of_id_idx" ON "public_projects"("duplicate_of_id");
CREATE INDEX IF NOT EXISTS "public_projects_enrichment_source_idx" ON "public_projects"("enrichment_source");
CREATE INDEX IF NOT EXISTS "public_projects_taxonomy_status_idx" ON "public_projects"("taxonomy_status");

CREATE TABLE IF NOT EXISTS "public_project_research_areas" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "taxonomy_area_id" TEXT,
  "taxonomy_level1_code" TEXT,
  "taxonomy_level2_code" TEXT,
  "label" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "source" TEXT NOT NULL DEFAULT 'heuristic',
  "rationale" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_project_research_areas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_project_research_areas_project_label_key"
  ON "public_project_research_areas"("project_id", "label");
CREATE INDEX IF NOT EXISTS "public_project_research_areas_project_id_idx"
  ON "public_project_research_areas"("project_id");
CREATE INDEX IF NOT EXISTS "public_project_research_areas_taxonomy_area_id_idx"
  ON "public_project_research_areas"("taxonomy_area_id");
CREATE INDEX IF NOT EXISTS "public_project_research_areas_taxonomy_codes_idx"
  ON "public_project_research_areas"("taxonomy_level1_code", "taxonomy_level2_code");

ALTER TABLE "public_project_research_areas"
  ADD CONSTRAINT "public_project_research_areas_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "public_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "idea_intelligence_sessions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "project_id" TEXT,
  "idea_bank_idea_id" TEXT,
  "anchor_public_project_id" TEXT,
  "title" TEXT NOT NULL,
  "current_version_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idea_intelligence_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idea_intelligence_sessions_user_created_idx"
  ON "idea_intelligence_sessions"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idea_intelligence_sessions_tenant_status_idx"
  ON "idea_intelligence_sessions"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "idea_intelligence_versions" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "idea_text" TEXT NOT NULL,
  "structured_idea_json" JSONB,
  "parent_version_id" TEXT,
  "refinement_objective" TEXT,
  "refinement_rationale" TEXT,
  "score_delta_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idea_intelligence_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idea_intelligence_versions_session_number_key"
  ON "idea_intelligence_versions"("session_id", "version_number");
CREATE INDEX IF NOT EXISTS "idea_intelligence_versions_session_created_idx"
  ON "idea_intelligence_versions"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idea_intelligence_versions_parent_idx"
  ON "idea_intelligence_versions"("parent_version_id");

ALTER TABLE "idea_intelligence_versions"
  ADD CONSTRAINT "idea_intelligence_versions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "idea_intelligence_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "idea_intelligence_runs"
  ADD COLUMN IF NOT EXISTS "session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stage_states_json" JSONB;

CREATE INDEX IF NOT EXISTS "idea_intelligence_runs_session_created_idx"
  ON "idea_intelligence_runs"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idea_intelligence_runs_version_idx"
  ON "idea_intelligence_runs"("version_id");

ALTER TABLE "idea_intelligence_runs"
  ADD CONSTRAINT "idea_intelligence_runs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "idea_intelligence_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "idea_intelligence_runs"
  ADD CONSTRAINT "idea_intelligence_runs_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "idea_intelligence_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
