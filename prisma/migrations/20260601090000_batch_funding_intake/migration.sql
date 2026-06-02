-- CreateEnum
CREATE TYPE "FundingIntakeBatchStatus" AS ENUM ('processing', 'completed', 'partially_failed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "FundingIntakeSourceStatus" AS ENUM ('pending', 'fetching', 'ready', 'failed');

-- AlterTable
ALTER TABLE "funding_intake_jobs"
ADD COLUMN "batch_id" TEXT,
ADD COLUMN "details_source_key" TEXT,
ADD COLUMN "guidelines_source_key" TEXT,
ADD COLUMN "template_source_key" TEXT,
ADD COLUMN "processing_phase" TEXT,
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "locked_at" TIMESTAMP(3),
ADD COLUMN "locked_by" TEXT,
ADD COLUMN "next_attempt_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "funding_intake_batches" (
  "id" TEXT NOT NULL,
  "submitted_by_user_id" TEXT NOT NULL,
  "label" TEXT,
  "status" "FundingIntakeBatchStatus" NOT NULL DEFAULT 'processing',
  "total_jobs" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "funding_intake_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_intake_job_sources" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL DEFAULT 0,
  "input_type" "FundingInputType" NOT NULL,
  "source_url" TEXT,
  "source_text_hash" TEXT,
  "source_file_path" TEXT,
  "raw_text" TEXT,
  "normalized_text" TEXT,
  "fetch_metadata_json" JSONB,
  "status" "FundingIntakeSourceStatus" NOT NULL DEFAULT 'pending',
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "funding_intake_job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funding_intake_jobs_batch_id_idx" ON "funding_intake_jobs"("batch_id");

-- CreateIndex
CREATE INDEX "funding_intake_jobs_status_next_attempt_at_idx" ON "funding_intake_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "funding_intake_jobs_locked_at_idx" ON "funding_intake_jobs"("locked_at");

-- CreateIndex
CREATE INDEX "funding_intake_batches_submitted_by_user_id_idx" ON "funding_intake_batches"("submitted_by_user_id");

-- CreateIndex
CREATE INDEX "funding_intake_batches_status_idx" ON "funding_intake_batches"("status");

-- CreateIndex
CREATE INDEX "funding_intake_batches_created_at_idx" ON "funding_intake_batches"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "funding_intake_job_sources_job_id_source_key_key" ON "funding_intake_job_sources"("job_id", "source_key");

-- CreateIndex
CREATE INDEX "funding_intake_job_sources_job_id_sequence_no_idx" ON "funding_intake_job_sources"("job_id", "sequence_no");

-- CreateIndex
CREATE INDEX "funding_intake_job_sources_status_idx" ON "funding_intake_job_sources"("status");

-- CreateIndex
CREATE INDEX "funding_intake_job_sources_source_text_hash_idx" ON "funding_intake_job_sources"("source_text_hash");

-- AddForeignKey
ALTER TABLE "funding_intake_jobs"
ADD CONSTRAINT "funding_intake_jobs_batch_id_fkey"
FOREIGN KEY ("batch_id") REFERENCES "funding_intake_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_intake_job_sources"
ADD CONSTRAINT "funding_intake_job_sources_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "funding_intake_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
