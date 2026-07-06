CREATE TABLE IF NOT EXISTS "funded_project_raw_sources" (
  "id" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_country" TEXT,
  "source_agency" TEXT,
  "source_project_id" TEXT NOT NULL,
  "source_url" TEXT,
  "project_title" TEXT,
  "project_abstract" TEXT,
  "project_objectives" TEXT,
  "principal_investigator" TEXT,
  "lead_institution" TEXT,
  "funding_program" TEXT,
  "funding_scheme" TEXT,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "fiscal_year" INTEGER,
  "raw_payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "content_hash" TEXT NOT NULL DEFAULT '',
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funded_project_raw_sources_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "funded_project_raw_sources"
  ADD COLUMN IF NOT EXISTS "funding_program" TEXT,
  ADD COLUMN IF NOT EXISTS "funding_scheme" TEXT,
  ADD COLUMN IF NOT EXISTS "start_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "end_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fiscal_year" INTEGER,
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "funded_project_raw_sources"
  ALTER COLUMN "raw_payload_json" SET DEFAULT '{}'::jsonb;

UPDATE "funded_project_raw_sources"
SET
  "raw_payload_json" = COALESCE("raw_payload_json", '{}'::jsonb),
  "content_hash" = COALESCE(NULLIF("content_hash", ''), md5(COALESCE("raw_payload_json"::text, '{}'))),
  "last_seen_at" = COALESCE("last_seen_at", CURRENT_TIMESTAMP),
  "first_seen_at" = COALESCE("first_seen_at", "created_at", CURRENT_TIMESTAMP)
WHERE "raw_payload_json" IS NULL
   OR "content_hash" = ''
   OR "last_seen_at" IS NULL
   OR "first_seen_at" IS NULL;

ALTER TABLE "funded_project_raw_sources"
  ALTER COLUMN "raw_payload_json" SET NOT NULL,
  ALTER COLUMN "content_hash" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "funded_project_raw_sources_source_project_key"
  ON "funded_project_raw_sources"("source_name", "source_project_id");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_source_name_idx"
  ON "funded_project_raw_sources"("source_name");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_source_country_idx"
  ON "funded_project_raw_sources"("source_country");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_source_agency_idx"
  ON "funded_project_raw_sources"("source_agency");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_source_project_id_idx"
  ON "funded_project_raw_sources"("source_project_id");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_lead_institution_idx"
  ON "funded_project_raw_sources"("lead_institution");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_fiscal_year_idx"
  ON "funded_project_raw_sources"("fiscal_year");

CREATE INDEX IF NOT EXISTS "funded_project_raw_sources_start_date_idx"
  ON "funded_project_raw_sources"("start_date");
