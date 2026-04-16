-- Create DeepAnalysisStatus enum if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeepAnalysisStatus') THEN
    CREATE TYPE "DeepAnalysisStatus" AS ENUM ('PENDING', 'PREPARING', 'EXTRACTING', 'MAPPING', 'COMPLETED', 'FAILED');
  END IF;
END $$;

-- Add deep-analysis tracking columns to citations
ALTER TABLE "citations" ADD COLUMN IF NOT EXISTS "deepAnalysisStatus" TEXT;
ALTER TABLE "citations" ADD COLUMN IF NOT EXISTS "deepAnalysisLabel" TEXT;
ALTER TABLE "citations" ADD COLUMN IF NOT EXISTS "evidenceCardCount" INTEGER;

-- Add full-text parser metadata columns to reference_documents
ALTER TABLE "reference_documents" ADD COLUMN IF NOT EXISTS "sections_json" JSONB;
ALTER TABLE "reference_documents" ADD COLUMN IF NOT EXISTS "parser_used" TEXT;

-- Create deep_analysis_jobs table
CREATE TABLE IF NOT EXISTS "deep_analysis_jobs" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "citation_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "status" "DeepAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "error" TEXT,
  "warning" TEXT,
  "reference_archetype" TEXT NOT NULL,
  "deep_analysis_label" TEXT NOT NULL,
  "text_source" TEXT NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deep_analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- Create evidence_cards table
CREATE TABLE IF NOT EXISTS "evidence_cards" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "citation_id" TEXT NOT NULL,
  "citation_key" TEXT NOT NULL,
  "reference_archetype" TEXT NOT NULL,
  "deep_analysis_label" TEXT NOT NULL,
  "source_section" TEXT,
  "claim" TEXT NOT NULL,
  "claim_type" TEXT NOT NULL,
  "quantitative_detail" TEXT,
  "conditions" TEXT,
  "comparable_metrics" JSONB,
  "does_not_support" TEXT,
  "scope_condition" TEXT,
  "study_design" TEXT,
  "rigor_indicators" TEXT,
  "source_fragment" TEXT NOT NULL,
  "page_hint" TEXT,
  "quote_verified" BOOLEAN NOT NULL DEFAULT false,
  "quote_verification_method" TEXT,
  "quote_verification_score" DOUBLE PRECISION,
  "confidence" TEXT NOT NULL,
  "extracted_from" TEXT NOT NULL DEFAULT 'FULL_TEXT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_cards_pkey" PRIMARY KEY ("id")
);

-- Create evidence_card_mappings table
CREATE TABLE IF NOT EXISTS "evidence_card_mappings" (
  "id" TEXT NOT NULL,
  "card_id" TEXT NOT NULL,
  "section_key" TEXT NOT NULL,
  "dimension" TEXT NOT NULL,
  "use_as" TEXT NOT NULL,
  "mapping_confidence" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_card_mappings_pkey" PRIMARY KEY ("id")
);

-- Ensure updated_at defaults are set for resilience with raw SQL writes
ALTER TABLE "deep_analysis_jobs" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "evidence_cards" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Unique/indexes
CREATE UNIQUE INDEX IF NOT EXISTS "deep_analysis_jobs_session_id_citation_id_key"
  ON "deep_analysis_jobs"("session_id", "citation_id");
CREATE INDEX IF NOT EXISTS "deep_analysis_jobs_session_id_status_idx"
  ON "deep_analysis_jobs"("session_id", "status");
CREATE INDEX IF NOT EXISTS "deep_analysis_jobs_batch_id_idx"
  ON "deep_analysis_jobs"("batch_id");

CREATE INDEX IF NOT EXISTS "evidence_cards_session_id_idx"
  ON "evidence_cards"("session_id");
CREATE INDEX IF NOT EXISTS "evidence_cards_citation_id_idx"
  ON "evidence_cards"("citation_id");
CREATE INDEX IF NOT EXISTS "evidence_cards_session_id_citation_key_idx"
  ON "evidence_cards"("session_id", "citation_key");
CREATE INDEX IF NOT EXISTS "evidence_cards_job_id_idx"
  ON "evidence_cards"("job_id");

CREATE INDEX IF NOT EXISTS "evidence_card_mappings_card_id_idx"
  ON "evidence_card_mappings"("card_id");
CREATE INDEX IF NOT EXISTS "evidence_card_mappings_section_key_idx"
  ON "evidence_card_mappings"("section_key");
CREATE INDEX IF NOT EXISTS "evidence_card_mappings_section_key_dimension_idx"
  ON "evidence_card_mappings"("section_key", "dimension");

CREATE INDEX IF NOT EXISTS "citations_session_id_deep_analysis_status_idx"
  ON "citations"("sessionId", "deepAnalysisStatus");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deep_analysis_jobs_session_id_fkey'
  ) THEN
    ALTER TABLE "deep_analysis_jobs"
      ADD CONSTRAINT "deep_analysis_jobs_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deep_analysis_jobs_citation_id_fkey'
  ) THEN
    ALTER TABLE "deep_analysis_jobs"
      ADD CONSTRAINT "deep_analysis_jobs_citation_id_fkey"
      FOREIGN KEY ("citation_id") REFERENCES "citations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidence_cards_job_id_fkey'
  ) THEN
    ALTER TABLE "evidence_cards"
      ADD CONSTRAINT "evidence_cards_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "deep_analysis_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidence_cards_session_id_fkey'
  ) THEN
    ALTER TABLE "evidence_cards"
      ADD CONSTRAINT "evidence_cards_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidence_cards_citation_id_fkey'
  ) THEN
    ALTER TABLE "evidence_cards"
      ADD CONSTRAINT "evidence_cards_citation_id_fkey"
      FOREIGN KEY ("citation_id") REFERENCES "citations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidence_card_mappings_card_id_fkey'
  ) THEN
    ALTER TABLE "evidence_card_mappings"
      ADD CONSTRAINT "evidence_card_mappings_card_id_fkey"
      FOREIGN KEY ("card_id") REFERENCES "evidence_cards"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
