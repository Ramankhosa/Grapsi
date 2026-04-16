-- CreateEnum
CREATE TYPE "FundingInputType" AS ENUM ('url', 'text', 'pdf');

-- CreateEnum
CREATE TYPE "FundingCallStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FundingTemplateLifecycleStatus" AS ENUM ('none', 'draft', 'needs_review', 'approved');

-- CreateEnum
CREATE TYPE "FundingGuidelineLifecycleStatus" AS ENUM ('none', 'draft', 'needs_review', 'approved');

-- CreateEnum
CREATE TYPE "FundingCallTemplateStatus" AS ENUM ('draft', 'approved', 'archived');

-- CreateEnum
CREATE TYPE "FundingCallGuidelineStatus" AS ENUM ('draft', 'approved', 'archived');

-- CreateEnum
CREATE TYPE "FundingCallTemplateRunStatus" AS ENUM ('queued', 'extracting', 'needs_review', 'failed', 'applied', 'rejected');

-- CreateEnum
CREATE TYPE "FundingCallGuidelineRunStatus" AS ENUM ('queued', 'extracting', 'needs_review', 'failed');

-- CreateEnum
CREATE TYPE "FundingCallTemplateRevisionType" AS ENUM ('manual_create', 'manual_edit', 'extraction_import', 'approval', 'reorder', 'delete_item', 'revert');

-- CreateEnum
CREATE TYPE "FundingCallGuidelineRevisionType" AS ENUM ('auto_extract', 'manual_edit', 'approval', 'revert');

-- CreateEnum
CREATE TYPE "FundingTemplateAssetSourceType" AS ENUM ('url', 'pdf', 'image', 'text');

-- CreateEnum
CREATE TYPE "FundingIntakeJobStatus" AS ENUM ('queued', 'fetching', 'extracting', 'needs_review', 'draft_created', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "FundingDuplicateStatus" AS ENUM ('none', 'candidate_found', 'exact_match_found', 'resolved');

-- CreateEnum
CREATE TYPE "FundingDuplicateMatchType" AS ENUM ('exact_fingerprint', 'fuzzy_title_agency', 'same_source_url', 'same_deadline_cluster');

-- CreateEnum
CREATE TYPE "FundingDuplicateResolution" AS ENUM ('pending', 'ignored', 'merged_to_existing', 'create_new_anyway');

-- AlterTable
ALTER TABLE "funding_call_guideline_revisions" ADD COLUMN     "approved_state" "FundingCallGuidelineStatus",
ADD COLUMN     "change_notes" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "diff_summary" TEXT,
ADD COLUMN     "editor_user_id" TEXT,
ADD COLUMN     "guideline_id" TEXT,
ADD COLUMN     "guideline_pack_json" JSONB,
ADD COLUMN     "revision_no" INTEGER,
ADD COLUMN     "revision_type" "FundingCallGuidelineRevisionType";

-- AlterTable
ALTER TABLE "funding_call_guidelines" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "current_revision_no" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "guideline_pack_json" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "last_edited_at" TIMESTAMP(3),
ADD COLUMN     "last_edited_by" TEXT,
ADD COLUMN     "status" "FundingCallGuidelineStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "funding_call_template_revisions" ADD COLUMN     "approved_state" "FundingCallTemplateStatus",
ADD COLUMN     "change_notes" TEXT,
ADD COLUMN     "compatibility_json" JSONB,
ADD COLUMN     "compiled_papsi_json" JSONB,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "diff_summary" TEXT,
ADD COLUMN     "editor_user_id" TEXT,
ADD COLUMN     "grant_template_json" JSONB,
ADD COLUMN     "revision_no" INTEGER,
ADD COLUMN     "revision_type" "FundingCallTemplateRevisionType",
ADD COLUMN     "template_id" TEXT;

-- AlterTable
ALTER TABLE "funding_call_templates" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "compatibility_json" JSONB,
ADD COLUMN     "compiled_papsi_json" JSONB,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "current_revision_no" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "grant_template_json" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "last_edited_at" TIMESTAMP(3),
ADD COLUMN     "last_edited_by" TEXT,
ADD COLUMN     "status" "FundingCallTemplateStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "funding_calls" ADD COLUMN     "active_guideline_id" TEXT,
ADD COLUMN     "active_template_id" TEXT,
ADD COLUMN     "agency_name" TEXT,
ADD COLUMN     "amount_max" DOUBLE PRECISION,
ADD COLUMN     "amount_min" DOUBLE PRECISION,
ADD COLUMN     "application_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "career_stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "catalog_status" "FundingCallStatus" DEFAULT 'DRAFT',
ADD COLUMN     "citizenship_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "close_date" TIMESTAMP(3),
ADD COLUMN     "contact_info" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "disciplines" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "eligibility_text" TEXT,
ADD COLUMN     "eligible_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "eligible_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "expected_deliverables_text" TEXT,
ADD COLUMN     "expiration_date" TIMESTAMP(3),
ADD COLUMN     "extracted_json" JSONB,
ADD COLUMN     "extraction_confidence_json" JSONB,
ADD COLUMN     "funder_country" TEXT,
ADD COLUMN     "funding_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "geography_scope" TEXT,
ADD COLUMN     "guideline_status" "FundingGuidelineLifecycleStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "host_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "input_type" "FundingInputType",
ADD COLUMN     "institution_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "intake_job_id" TEXT,
ADD COLUMN     "is_active" BOOLEAN DEFAULT true,
ADD COLUMN     "is_rolling" BOOLEAN DEFAULT false,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "normalized_text" TEXT,
ADD COLUMN     "official_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "open_date" TIMESTAMP(3),
ADD COLUMN     "operator_notes" TEXT,
ADD COLUMN     "previous_version_id" TEXT,
ADD COLUMN     "project_duration_max_months" INTEGER,
ADD COLUMN     "project_duration_min_months" INTEGER,
ADD COLUMN     "project_duration_text" TEXT,
ADD COLUMN     "raw_text" TEXT,
ADD COLUMN     "residency_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scheme_title" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "source_text_hash" TEXT,
ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "sponsor_type" TEXT,
ADD COLUMN     "template_status" "FundingTemplateLifecycleStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "uploaded_by" TEXT,
ADD COLUMN     "version" INTEGER DEFAULT 1;

-- AlterTable

-- CreateTable
CREATE TABLE "funding_intake_jobs" (
    "id" TEXT NOT NULL,
    "submitted_by_user_id" TEXT NOT NULL,
    "linked_funding_call_id" TEXT,
    "input_type" "FundingInputType" NOT NULL,
    "source_url" TEXT,
    "source_text_hash" TEXT,
    "source_file_path" TEXT,
    "operator_notes" TEXT,
    "raw_text" TEXT,
    "normalized_text" TEXT,
    "fetch_metadata_json" JSONB,
    "status" "FundingIntakeJobStatus" NOT NULL DEFAULT 'queued',
    "duplicate_status" "FundingDuplicateStatus" NOT NULL DEFAULT 'none',
    "error_code" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_intake_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_intake_extractions" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "extractor_model" TEXT,
    "extractor_version" TEXT,
    "prompt_version" TEXT,
    "extracted_json" JSONB NOT NULL,
    "confidence_json" JSONB,
    "evidence_json" JSONB,
    "missing_fields_json" JSONB,
    "validation_errors_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_intake_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_intake_duplicates" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "candidate_funding_call_id" TEXT NOT NULL,
    "match_type" "FundingDuplicateMatchType" NOT NULL,
    "match_score" DOUBLE PRECISION NOT NULL,
    "resolution" "FundingDuplicateResolution" NOT NULL DEFAULT 'pending',
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_intake_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_intake_job_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "previous_status" TEXT,
    "next_status" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_intake_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_call_template_assets" (
    "id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL DEFAULT 0,
    "source_type" "FundingTemplateAssetSourceType" NOT NULL,
    "source_url" TEXT,
    "storage_path" TEXT,
    "mime" TEXT,
    "raw_text" TEXT,
    "normalized_text" TEXT,
    "ocr_text" TEXT,
    "source_metadata_json" JSONB,
    "checksum" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_template_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_call_template_runs" (
    "id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" "FundingCallTemplateRunStatus" NOT NULL,
    "asset_set_hash" TEXT NOT NULL,
    "extractor_model" TEXT,
    "prompt_version" TEXT,
    "raw_output_json" JSONB,
    "normalized_template_json" JSONB,
    "compatibility_json" JSONB,
    "warnings_json" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_template_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_call_guideline_runs" (
    "id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "guideline_id" TEXT NOT NULL,
    "status" "FundingCallGuidelineRunStatus" NOT NULL,
    "extractor_model" TEXT,
    "prompt_version" TEXT,
    "raw_output_json" JSONB,
    "guideline_pack_json" JSONB,
    "warnings_json" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_guideline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funding_intake_jobs_submitted_by_user_id_idx" ON "funding_intake_jobs"("submitted_by_user_id");

-- CreateIndex
CREATE INDEX "funding_intake_jobs_status_idx" ON "funding_intake_jobs"("status");

-- CreateIndex
CREATE INDEX "funding_intake_jobs_source_text_hash_idx" ON "funding_intake_jobs"("source_text_hash");

-- CreateIndex
CREATE INDEX "funding_intake_jobs_linked_funding_call_id_idx" ON "funding_intake_jobs"("linked_funding_call_id");

-- CreateIndex
CREATE INDEX "funding_intake_extractions_job_id_idx" ON "funding_intake_extractions"("job_id");

-- CreateIndex
CREATE INDEX "funding_intake_duplicates_job_id_idx" ON "funding_intake_duplicates"("job_id");

-- CreateIndex
CREATE INDEX "funding_intake_duplicates_candidate_funding_call_id_idx" ON "funding_intake_duplicates"("candidate_funding_call_id");

-- CreateIndex
CREATE INDEX "funding_intake_job_events_job_id_idx" ON "funding_intake_job_events"("job_id");

-- CreateIndex
CREATE INDEX "funding_call_template_assets_funding_call_id_sequence_no_idx" ON "funding_call_template_assets"("funding_call_id", "sequence_no");

-- CreateIndex
CREATE INDEX "funding_call_template_assets_funding_call_id_created_at_idx" ON "funding_call_template_assets"("funding_call_id", "created_at");

-- CreateIndex
CREATE INDEX "funding_call_template_assets_checksum_idx" ON "funding_call_template_assets"("checksum");

-- CreateIndex
CREATE INDEX "funding_call_template_runs_funding_call_id_created_at_idx" ON "funding_call_template_runs"("funding_call_id", "created_at");

-- CreateIndex
CREATE INDEX "funding_call_template_runs_template_id_created_at_idx" ON "funding_call_template_runs"("template_id", "created_at");

-- CreateIndex
CREATE INDEX "funding_call_template_runs_status_idx" ON "funding_call_template_runs"("status");

-- CreateIndex
CREATE INDEX "funding_call_guideline_runs_funding_call_id_created_at_idx" ON "funding_call_guideline_runs"("funding_call_id", "created_at");

-- CreateIndex
CREATE INDEX "funding_call_guideline_runs_guideline_id_created_at_idx" ON "funding_call_guideline_runs"("guideline_id", "created_at");

-- CreateIndex
CREATE INDEX "funding_call_guideline_runs_status_idx" ON "funding_call_guideline_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "funding_call_guideline_revisions_guideline_id_revision_no_key" ON "funding_call_guideline_revisions"("guideline_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "funding_call_template_revisions_template_id_revision_no_key" ON "funding_call_template_revisions"("template_id", "revision_no");

-- CreateIndex
CREATE INDEX "funding_calls_catalog_status_idx" ON "funding_calls"("catalog_status");

-- CreateIndex
CREATE INDEX "funding_calls_template_status_idx" ON "funding_calls"("template_status");

-- CreateIndex
CREATE INDEX "funding_calls_guideline_status_idx" ON "funding_calls"("guideline_status");

-- CreateIndex
CREATE INDEX "funding_calls_input_type_idx" ON "funding_calls"("input_type");

-- CreateIndex
CREATE INDEX "funding_calls_source_url_idx" ON "funding_calls"("source_url");

-- CreateIndex
CREATE INDEX "funding_calls_intake_job_id_idx" ON "funding_calls"("intake_job_id");

-- CreateIndex
CREATE INDEX "funding_calls_active_template_id_idx" ON "funding_calls"("active_template_id");

-- CreateIndex
CREATE INDEX "funding_calls_active_guideline_id_idx" ON "funding_calls"("active_guideline_id");

-- AddForeignKey
ALTER TABLE "funding_calls" ADD CONSTRAINT "funding_calls_active_template_id_fkey" FOREIGN KEY ("active_template_id") REFERENCES "funding_call_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_calls" ADD CONSTRAINT "funding_calls_active_guideline_id_fkey" FOREIGN KEY ("active_guideline_id") REFERENCES "funding_call_guidelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_intake_jobs" ADD CONSTRAINT "funding_intake_jobs_linked_funding_call_id_fkey" FOREIGN KEY ("linked_funding_call_id") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_template_assets" ADD CONSTRAINT "funding_call_template_assets_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_template_runs" ADD CONSTRAINT "funding_call_template_runs_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_template_runs" ADD CONSTRAINT "funding_call_template_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "funding_call_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_guideline_runs" ADD CONSTRAINT "funding_call_guideline_runs_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_guideline_runs" ADD CONSTRAINT "funding_call_guideline_runs_guideline_id_fkey" FOREIGN KEY ("guideline_id") REFERENCES "funding_call_guidelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

