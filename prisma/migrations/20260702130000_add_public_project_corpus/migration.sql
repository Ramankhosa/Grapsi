CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectSourceKey') THEN
    CREATE TYPE "PublicProjectSourceKey" AS ENUM ('PRISM', 'BIRAC', 'CSIR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectRecordStatus') THEN
    CREATE TYPE "PublicProjectRecordStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'INACTIVE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectEmbeddingStatus') THEN
    CREATE TYPE "PublicProjectEmbeddingStatus" AS ENUM ('not_generated', 'processing', 'generated', 'stale', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectCrawlMode') THEN
    CREATE TYPE "PublicProjectCrawlMode" AS ENUM ('pilot', 'full', 'incremental');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectCrawlStatus') THEN
    CREATE TYPE "PublicProjectCrawlStatus" AS ENUM (
      'queued',
      'running',
      'completed',
      'completed_with_errors',
      'failed',
      'blocked',
      'cancel_requested',
      'canceled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectCrawlItemStatus') THEN
    CREATE TYPE "PublicProjectCrawlItemStatus" AS ENUM (
      'discovered',
      'processing',
      'completed',
      'failed',
      'skipped',
      'quarantined'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicProjectParticipantRole') THEN
    CREATE TYPE "PublicProjectParticipantRole" AS ENUM ('PI', 'CO_PI', 'TEAM_MEMBER', 'NODAL_CONTACT', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public_project_sources" (
  "id" TEXT NOT NULL,
  "source_key" "PublicProjectSourceKey" NOT NULL,
  "name" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "connector_version" TEXT NOT NULL DEFAULT 'v1',
  "crawl_config_json" JSONB,
  "schedule_config_json" JSONB,
  "health_json" JSONB,
  "last_successful_run_id" TEXT,
  "last_run_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_project_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public_projects" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_key" "PublicProjectSourceKey" NOT NULL,
  "external_id" TEXT NOT NULL,
  "file_number" TEXT,
  "project_number" TEXT,
  "source_url" TEXT,
  "detail_url" TEXT,
  "source_variant" TEXT NOT NULL DEFAULT 'online',
  "source_record_key" TEXT NOT NULL,
  "status_text" TEXT,
  "project_type" TEXT,
  "record_status" "PublicProjectRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "validation_errors_json" JSONB,
  "program_name" TEXT,
  "scheme_name" TEXT,
  "scheme_hierarchy_json" JSONB,
  "category" TEXT,
  "theme" TEXT,
  "discipline" TEXT,
  "area_name" TEXT,
  "sub_area_name" TEXT,
  "title" TEXT NOT NULL,
  "abstract" TEXT,
  "executive_summary" TEXT,
  "objectives" TEXT,
  "milestones" TEXT,
  "deliverables" TEXT,
  "output_planned" TEXT,
  "output_achieved" TEXT,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "primary_investigator_name" TEXT,
  "primary_institution_name" TEXT,
  "department_name" TEXT,
  "city" TEXT,
  "state" TEXT,
  "country" TEXT DEFAULT 'India',
  "sanction_year" INTEGER,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "duration_months" INTEGER,
  "budget_amount" NUMERIC(18,2),
  "budget_currency" TEXT DEFAULT 'INR',
  "budget_components_json" JSONB,
  "manpower_json" JSONB,
  "equipment_json" JSONB,
  "publications_json" JSONB,
  "patents_json" JSONB,
  "outcomes_json" JSONB,
  "raw_payload_json" JSONB,
  "extended_fields_json" JSONB,
  "content_hash" TEXT NOT NULL,
  "detail_hash" TEXT,
  "duplicate_fingerprint" TEXT,
  "missing_full_run_count" INTEGER NOT NULL DEFAULT 0,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_changed_at" TIMESTAMP(3),
  "inactive_at" TIMESTAMP(3),
  "embedding_provider" TEXT,
  "embedding_model" TEXT,
  "embedding_dimension" INTEGER,
  "embedding_version" TEXT,
  "embedding_input_hash" TEXT,
  "embedding_status" "PublicProjectEmbeddingStatus" NOT NULL DEFAULT 'not_generated',
  "embedding_error" TEXT,
  "embedding" vector(768),
  "embedding_voyage_1024" vector(1024),
  "ts_document" tsvector,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public_project_participants" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "role" "PublicProjectParticipantRole" NOT NULL DEFAULT 'TEAM_MEMBER',
  "name" TEXT NOT NULL,
  "institution_name" TEXT,
  "department_name" TEXT,
  "city" TEXT,
  "state" TEXT,
  "country" TEXT DEFAULT 'India',
  "source_payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_project_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public_project_private_contacts" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "contact_type" TEXT NOT NULL,
  "label" TEXT,
  "value" TEXT NOT NULL,
  "source_payload_json" JSONB,
  "is_public_source" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_project_private_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public_project_crawl_runs" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "mode" "PublicProjectCrawlMode" NOT NULL,
  "filters_json" JSONB,
  "status" "PublicProjectCrawlStatus" NOT NULL DEFAULT 'queued',
  "discovered_count" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "succeeded_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "quarantined_count" INTEGER NOT NULL DEFAULT 0,
  "embedding_failed_count" INTEGER NOT NULL DEFAULT 0,
  "cursor_json" JSONB,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "heartbeat_at" TIMESTAMP(3),
  "requested_by_user_id" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancel_requested_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_project_crawl_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public_project_crawl_items" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "project_id" TEXT,
  "source_record_key" TEXT NOT NULL,
  "source_variant" TEXT,
  "external_id" TEXT,
  "state" TEXT,
  "status" "PublicProjectCrawlItemStatus" NOT NULL DEFAULT 'discovered',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "listing_payload_json" JSONB,
  "detail_payload_json" JSONB,
  "content_hash" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_project_crawl_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public_project_revisions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "run_id" TEXT,
  "content_hash" TEXT NOT NULL,
  "normalized_payload_json" JSONB NOT NULL,
  "raw_payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_project_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_project_sources_source_key_key"
  ON "public_project_sources"("source_key");

CREATE UNIQUE INDEX IF NOT EXISTS "public_projects_source_id_source_record_key_key"
  ON "public_projects"("source_id", "source_record_key");

CREATE INDEX IF NOT EXISTS "public_projects_source_key_source_variant_idx"
  ON "public_projects"("source_key", "source_variant");

CREATE INDEX IF NOT EXISTS "public_projects_record_status_idx"
  ON "public_projects"("record_status");

CREATE INDEX IF NOT EXISTS "public_projects_title_idx"
  ON "public_projects"("title");

CREATE INDEX IF NOT EXISTS "public_projects_primary_institution_name_idx"
  ON "public_projects"("primary_institution_name");

CREATE INDEX IF NOT EXISTS "public_projects_state_idx"
  ON "public_projects"("state");

CREATE INDEX IF NOT EXISTS "public_projects_sanction_year_idx"
  ON "public_projects"("sanction_year");

CREATE INDEX IF NOT EXISTS "public_projects_duplicate_fingerprint_idx"
  ON "public_projects"("duplicate_fingerprint");

CREATE INDEX IF NOT EXISTS "public_projects_embedding_idx"
  ON "public_projects" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS "public_projects_embedding_voyage_1024_idx"
  ON "public_projects" USING ivfflat ("embedding_voyage_1024" vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS "public_projects_ts_idx"
  ON "public_projects" USING GIN ("ts_document");

CREATE INDEX IF NOT EXISTS "public_project_participants_project_id_idx"
  ON "public_project_participants"("project_id");

CREATE INDEX IF NOT EXISTS "public_project_participants_name_idx"
  ON "public_project_participants"("name");

CREATE INDEX IF NOT EXISTS "public_project_participants_institution_name_idx"
  ON "public_project_participants"("institution_name");

CREATE UNIQUE INDEX IF NOT EXISTS "public_project_private_contacts_project_id_contact_type_val_key"
  ON "public_project_private_contacts"("project_id", "contact_type", "value");

CREATE INDEX IF NOT EXISTS "public_project_private_contacts_project_id_idx"
  ON "public_project_private_contacts"("project_id");

CREATE INDEX IF NOT EXISTS "public_project_private_contacts_contact_type_idx"
  ON "public_project_private_contacts"("contact_type");

CREATE INDEX IF NOT EXISTS "public_project_crawl_runs_source_id_status_idx"
  ON "public_project_crawl_runs"("source_id", "status");

CREATE INDEX IF NOT EXISTS "public_project_crawl_runs_status_created_at_idx"
  ON "public_project_crawl_runs"("status", "created_at");

CREATE INDEX IF NOT EXISTS "public_project_crawl_runs_heartbeat_at_idx"
  ON "public_project_crawl_runs"("heartbeat_at");

CREATE UNIQUE INDEX IF NOT EXISTS "public_project_crawl_items_run_id_source_record_key_key"
  ON "public_project_crawl_items"("run_id", "source_record_key");

CREATE INDEX IF NOT EXISTS "public_project_crawl_items_status_idx"
  ON "public_project_crawl_items"("status");

CREATE INDEX IF NOT EXISTS "public_project_crawl_items_project_id_idx"
  ON "public_project_crawl_items"("project_id");

CREATE INDEX IF NOT EXISTS "public_project_crawl_items_state_idx"
  ON "public_project_crawl_items"("state");

CREATE UNIQUE INDEX IF NOT EXISTS "public_project_revisions_project_id_content_hash_key"
  ON "public_project_revisions"("project_id", "content_hash");

CREATE INDEX IF NOT EXISTS "public_project_revisions_run_id_idx"
  ON "public_project_revisions"("run_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_projects_source_id_fkey') THEN
    ALTER TABLE "public_projects"
      ADD CONSTRAINT "public_projects_source_id_fkey"
      FOREIGN KEY ("source_id") REFERENCES "public_project_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_participants_project_id_fkey') THEN
    ALTER TABLE "public_project_participants"
      ADD CONSTRAINT "public_project_participants_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "public_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_private_contacts_project_id_fkey') THEN
    ALTER TABLE "public_project_private_contacts"
      ADD CONSTRAINT "public_project_private_contacts_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "public_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_crawl_runs_source_id_fkey') THEN
    ALTER TABLE "public_project_crawl_runs"
      ADD CONSTRAINT "public_project_crawl_runs_source_id_fkey"
      FOREIGN KEY ("source_id") REFERENCES "public_project_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_crawl_items_run_id_fkey') THEN
    ALTER TABLE "public_project_crawl_items"
      ADD CONSTRAINT "public_project_crawl_items_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "public_project_crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_crawl_items_project_id_fkey') THEN
    ALTER TABLE "public_project_crawl_items"
      ADD CONSTRAINT "public_project_crawl_items_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "public_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_revisions_project_id_fkey') THEN
    ALTER TABLE "public_project_revisions"
      ADD CONSTRAINT "public_project_revisions_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "public_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_project_revisions_run_id_fkey') THEN
    ALTER TABLE "public_project_revisions"
      ADD CONSTRAINT "public_project_revisions_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "public_project_crawl_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public_project_tsvector_update()
RETURNS trigger AS $$
BEGIN
  NEW."ts_document" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."abstract", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."executive_summary", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."objectives", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."primary_institution_name", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."scheme_name", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."area_name", '')), 'D') ||
    setweight(to_tsvector('english', coalesce(NEW."sub_area_name", '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS public_projects_tsvector_update ON "public_projects";
CREATE TRIGGER public_projects_tsvector_update
BEFORE INSERT OR UPDATE OF
  "title",
  "abstract",
  "executive_summary",
  "objectives",
  "primary_institution_name",
  "scheme_name",
  "area_name",
  "sub_area_name"
ON "public_projects"
FOR EACH ROW EXECUTE FUNCTION public_project_tsvector_update();

