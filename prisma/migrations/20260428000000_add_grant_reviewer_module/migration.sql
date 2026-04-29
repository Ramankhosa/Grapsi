DO $$ BEGIN
  CREATE TYPE "CallInputType" AS ENUM ('url', 'file', 'text');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReviewStatus" AS ENUM ('parsed', 'pending', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SectionStatus" AS ENUM ('draft', 'reviewed', 'revised');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SectionAssetType" AS ENUM ('METHODOLOGY', 'TIMELINE', 'BUDGET_JUSTIFICATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "reviewer_calls" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenantId" TEXT,
  "projectId" TEXT,
  "grantSessionId" TEXT,
  "fundingCallId" TEXT,
  "project_title" TEXT NOT NULL,
  "agency_name" TEXT NOT NULL,
  "call_input_type" "CallInputType" NOT NULL,
  "call_input_data" TEXT NOT NULL,
  "parsed_json" JSONB NOT NULL DEFAULT '{}',
  "raw_text_backup" TEXT,
  "LLM_model_used" TEXT,
  "review_status" "ReviewStatus" NOT NULL DEFAULT 'parsed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "final_review_status" "ReviewStatus" NOT NULL DEFAULT 'parsed',
  "overall_review_json" JSONB,
  "review_progress_state" JSONB,
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "share_token" TEXT,
  CONSTRAINT "reviewer_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviewer_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "reviewer_sections" (
  "id" TEXT NOT NULL,
  "call_id" TEXT NOT NULL,
  "section_title" TEXT NOT NULL,
  "user_input" TEXT NOT NULL,
  "ai_review_json" JSONB NOT NULL DEFAULT '{}',
  "last_reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "SectionStatus" NOT NULL DEFAULT 'draft',
  "improvement_flag" BOOLEAN,
  "is_revision" BOOLEAN NOT NULL DEFAULT false,
  "previous_section_id" TEXT,
  "review_linked_context" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "context_summary" TEXT,
  CONSTRAINT "reviewer_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviewer_sections_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "reviewer_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "review_assets" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "gcs_uri" TEXT NOT NULL,
  "gcs_preview_uri" TEXT,
  "mime" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "sha256" VARCHAR(128) NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "page_count" INTEGER,
  "original_name" TEXT,
  "google_file_id" TEXT,
  "google_file_updated_at" TIMESTAMP(3),
  "ocr_text" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deprecated" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "review_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "review_asset_links" (
  "id" TEXT NOT NULL,
  "review_version_id" TEXT NOT NULL,
  "section_type" "SectionAssetType" NOT NULL,
  "asset_id" TEXT NOT NULL,
  "attach_in_prompt" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_asset_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_calls_share_token_key" ON "reviewer_calls"("share_token");
CREATE INDEX IF NOT EXISTS "reviewer_calls_user_id_idx" ON "reviewer_calls"("user_id");
CREATE INDEX IF NOT EXISTS "reviewer_calls_tenantId_idx" ON "reviewer_calls"("tenantId");
CREATE INDEX IF NOT EXISTS "reviewer_calls_projectId_idx" ON "reviewer_calls"("projectId");
CREATE INDEX IF NOT EXISTS "reviewer_calls_grantSessionId_idx" ON "reviewer_calls"("grantSessionId");
CREATE INDEX IF NOT EXISTS "reviewer_calls_fundingCallId_idx" ON "reviewer_calls"("fundingCallId");

CREATE INDEX IF NOT EXISTS "reviewer_sections_call_id_idx" ON "reviewer_sections"("call_id");
CREATE INDEX IF NOT EXISTS "reviewer_sections_call_id_section_title_version_idx" ON "reviewer_sections"("call_id", "section_title", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "review_assets_project_id_sha256_key" ON "review_assets"("project_id", "sha256");
CREATE INDEX IF NOT EXISTS "review_assets_project_id_idx" ON "review_assets"("project_id");
CREATE INDEX IF NOT EXISTS "review_assets_created_by_user_id_idx" ON "review_assets"("created_by_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "review_asset_links_review_version_id_section_type_asset_id_key" ON "review_asset_links"("review_version_id", "section_type", "asset_id");
CREATE INDEX IF NOT EXISTS "review_asset_links_review_version_id_section_type_idx" ON "review_asset_links"("review_version_id", "section_type");
CREATE INDEX IF NOT EXISTS "review_asset_links_asset_id_idx" ON "review_asset_links"("asset_id");
