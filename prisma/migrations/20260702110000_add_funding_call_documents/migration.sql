CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingCallDocumentKind') THEN
    CREATE TYPE "FundingCallDocumentKind" AS ENUM ('call_document');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingDocumentParsingStatus') THEN
    CREATE TYPE "FundingDocumentParsingStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingDocumentEmbeddingStatus') THEN
    CREATE TYPE "FundingDocumentEmbeddingStatus" AS ENUM ('not_generated', 'processing', 'generated', 'partial', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingCallDocumentSectionType') THEN
    CREATE TYPE "FundingCallDocumentSectionType" AS ENUM (
      'overview',
      'objectives',
      'thematic_areas',
      'eligibility',
      'funding_support',
      'budget_rules',
      'duration',
      'important_dates',
      'evaluation_criteria',
      'exclusions',
      'application_process',
      'required_documents',
      'consortium_partner_rules',
      'intellectual_property_rules',
      'reporting_requirements',
      'contact_details',
      'corrigendum_or_amendment',
      'other'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingCallDocumentClassificationMethod') THEN
    CREATE TYPE "FundingCallDocumentClassificationMethod" AS ENUM ('heading', 'llm', 'fallback');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingCallDocumentChunkEmbeddingStatus') THEN
    CREATE TYPE "FundingCallDocumentChunkEmbeddingStatus" AS ENUM ('pending', 'generated', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingCallDocumentEventType') THEN
    CREATE TYPE "FundingCallDocumentEventType" AS ENUM (
      'uploaded',
      'reprocessed',
      're_embedded',
      'superseded',
      'deleted_sections',
      'quality_flagged'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "funding_call_documents" (
  "id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "storage_path" TEXT NOT NULL,
  "source_url" TEXT,
  "checksum" TEXT NOT NULL,
  "uploaded_by" TEXT,
  "document_kind" "FundingCallDocumentKind" NOT NULL DEFAULT 'call_document',
  "parsing_status" "FundingDocumentParsingStatus" NOT NULL DEFAULT 'pending',
  "parsing_error" TEXT,
  "parsing_stats" JSONB,
  "quality_flags" JSONB,
  "needs_manual_review" BOOLEAN NOT NULL DEFAULT false,
  "embedding_status" "FundingDocumentEmbeddingStatus" NOT NULL DEFAULT 'not_generated',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_call_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "funding_call_document_pages" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "page_number" INTEGER NOT NULL,
  "raw_text" TEXT NOT NULL,
  "cleaned_text" TEXT NOT NULL,
  "extraction_confidence" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_call_document_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "funding_call_document_sections" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "section_type" "FundingCallDocumentSectionType" NOT NULL,
  "section_title" TEXT,
  "section_text" TEXT NOT NULL,
  "start_page" INTEGER NOT NULL,
  "end_page" INTEGER NOT NULL,
  "order_index" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION,
  "classification_method" "FundingCallDocumentClassificationMethod" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_call_document_sections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "funding_call_document_chunks" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "section_id" TEXT,
  "section_type" "FundingCallDocumentSectionType" NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "chunk_text" TEXT NOT NULL,
  "page_start" INTEGER NOT NULL,
  "page_end" INTEGER NOT NULL,
  "token_count" INTEGER NOT NULL,
  "embedding_provider" TEXT,
  "embedding_model" TEXT,
  "embedding_dimension" INTEGER,
  "embedding_status" "FundingCallDocumentChunkEmbeddingStatus" NOT NULL DEFAULT 'pending',
  "embedding_error" TEXT,
  "embedding" vector(768),
  "embedding_voyage_1024" vector(1024),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_call_document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "funding_call_document_events" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "event_type" "FundingCallDocumentEventType" NOT NULL,
  "actor_user_id" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_call_document_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "funding_call_documents_funding_call_id_checksum_key"
  ON "funding_call_documents"("funding_call_id", "checksum");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_call_documents_funding_call_id_version_key"
  ON "funding_call_documents"("funding_call_id", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_call_documents_one_active_idx"
  ON "funding_call_documents"("funding_call_id")
  WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "funding_call_documents_funding_call_id_is_active_idx"
  ON "funding_call_documents"("funding_call_id", "is_active");

CREATE INDEX IF NOT EXISTS "funding_call_documents_parsing_status_idx"
  ON "funding_call_documents"("parsing_status");

CREATE INDEX IF NOT EXISTS "funding_call_documents_embedding_status_idx"
  ON "funding_call_documents"("embedding_status");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_call_document_pages_document_id_page_number_key"
  ON "funding_call_document_pages"("document_id", "page_number");

CREATE INDEX IF NOT EXISTS "funding_call_document_pages_funding_call_id_idx"
  ON "funding_call_document_pages"("funding_call_id");

CREATE INDEX IF NOT EXISTS "funding_call_document_sections_funding_call_id_section_type_idx"
  ON "funding_call_document_sections"("funding_call_id", "section_type");

CREATE INDEX IF NOT EXISTS "funding_call_document_sections_document_id_order_index_idx"
  ON "funding_call_document_sections"("document_id", "order_index");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_call_document_chunks_document_id_chunk_index_key"
  ON "funding_call_document_chunks"("document_id", "chunk_index");

CREATE INDEX IF NOT EXISTS "funding_call_document_chunks_funding_call_id_section_type_idx"
  ON "funding_call_document_chunks"("funding_call_id", "section_type");

CREATE INDEX IF NOT EXISTS "funding_call_document_chunks_document_id_idx"
  ON "funding_call_document_chunks"("document_id");

CREATE INDEX IF NOT EXISTS "funding_call_document_chunks_embedding_status_idx"
  ON "funding_call_document_chunks"("embedding_status");

CREATE INDEX IF NOT EXISTS "funding_call_document_chunks_embedding_idx"
  ON "funding_call_document_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS "funding_call_document_chunks_embedding_voyage_1024_idx"
  ON "funding_call_document_chunks" USING ivfflat ("embedding_voyage_1024" vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS "funding_call_document_events_document_id_created_at_idx"
  ON "funding_call_document_events"("document_id", "created_at");

CREATE INDEX IF NOT EXISTS "funding_call_document_events_funding_call_id_created_at_idx"
  ON "funding_call_document_events"("funding_call_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_documents_funding_call_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_documents"
      ADD CONSTRAINT "funding_call_documents_funding_call_id_fkey"
      FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_pages_document_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_pages"
      ADD CONSTRAINT "funding_call_document_pages_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "funding_call_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_pages_funding_call_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_pages"
      ADD CONSTRAINT "funding_call_document_pages_funding_call_id_fkey"
      FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_sections_document_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_sections"
      ADD CONSTRAINT "funding_call_document_sections_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "funding_call_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_sections_funding_call_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_sections"
      ADD CONSTRAINT "funding_call_document_sections_funding_call_id_fkey"
      FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_chunks_document_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_chunks"
      ADD CONSTRAINT "funding_call_document_chunks_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "funding_call_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_chunks_funding_call_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_chunks"
      ADD CONSTRAINT "funding_call_document_chunks_funding_call_id_fkey"
      FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_chunks_section_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_chunks"
      ADD CONSTRAINT "funding_call_document_chunks_section_id_fkey"
      FOREIGN KEY ("section_id") REFERENCES "funding_call_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_events_document_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_events"
      ADD CONSTRAINT "funding_call_document_events_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "funding_call_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funding_call_document_events_funding_call_id_fkey'
  ) THEN
    ALTER TABLE "funding_call_document_events"
      ADD CONSTRAINT "funding_call_document_events_funding_call_id_fkey"
      FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "workflow_stages" (
  "id",
  "code",
  "displayName",
  "featureCode",
  "description",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'stage-funding-doc-page-transcribe',
    'FUNDING_DOC_PAGE_TRANSCRIBE',
    'Funding Document Page Transcription',
    'FUNDING_DISCOVERY',
    'Transcribes scanned or low-text funding-call document pages.',
    30,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'stage-funding-doc-section-classify',
    'FUNDING_DOC_SECTION_CLASSIFY',
    'Funding Document Section Classification',
    'FUNDING_DISCOVERY',
    'Classifies funding-call document sections into retrieval-aware section types.',
    40,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'stage-funding-doc-qa',
    'FUNDING_DOC_QA',
    'Funding Document Q&A',
    'FUNDING_DISCOVERY',
    'Answers call-specific questions from structured funding data and cited document evidence.',
    50,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "featureCode" = EXCLUDED."featureCode",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "plan_stage_model_configs" (
  "id",
  "planId",
  "stageId",
  "modelId",
  "fallbackModelIds",
  "maxTokensIn",
  "maxTokensOut",
  "temperature",
  "isActive",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('cfg-', p."id", '-funding-doc-page-transcribe'),
  p."id",
  s."id",
  m."id",
  NULL,
  2000000,
  12000,
  0,
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "plans" p
JOIN "workflow_stages" s ON s."code" = 'FUNDING_DOC_PAGE_TRANSCRIBE'
JOIN "llm_models" m ON m."code" = 'gemini-2.5-pro'
WHERE p."status" = 'ACTIVE'
ON CONFLICT ("planId", "stageId") DO NOTHING;

INSERT INTO "plan_stage_model_configs" (
  "id",
  "planId",
  "stageId",
  "modelId",
  "fallbackModelIds",
  "maxTokensIn",
  "maxTokensOut",
  "temperature",
  "isActive",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('cfg-', p."id", '-', lower(replace(s."code", '_', '-'))),
  p."id",
  s."id",
  m."id",
  NULL,
  120000,
  6000,
  0,
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "plans" p
JOIN "workflow_stages" s ON s."code" IN ('FUNDING_DOC_SECTION_CLASSIFY', 'FUNDING_DOC_QA')
JOIN "llm_models" m ON m."code" = 'deepseek-v4-pro'
WHERE p."status" = 'ACTIVE'
ON CONFLICT ("planId", "stageId") DO NOTHING;
