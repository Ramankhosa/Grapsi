-- Phase 2 funding ingestion core:
-- - ingestion outcomes/assets/state
-- - funding call metadata for duplicate detection and moderation
-- - support for tenant-private and platform/global import jobs

ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'FUNDING_CALL_INGEST';
ALTER TYPE "FundingImportJobStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';

CREATE TYPE "FundingImportOutcome" AS ENUM ('CREATED', 'UPDATED', 'REUSED_EXISTING', 'DUPLICATE_BLOCKED', 'FAILED');
CREATE TYPE "FundingImportAssetKind" AS ENUM ('UPLOADED_FILE', 'FETCHED_SOURCE', 'RAW_TEXT', 'NORMALIZED_TEXT', 'EXTRACTED_TEXT');

ALTER TABLE "funding_calls"
  ADD COLUMN "sourceFingerprint" TEXT,
  ADD COLUMN "sourceDomain" TEXT,
  ADD COLUMN "programIdentifier" TEXT,
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "deadlineAt" TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "funding_calls_sourceUrl_idx" ON "funding_calls"("sourceUrl");
CREATE INDEX "funding_calls_sourceFingerprint_idx" ON "funding_calls"("sourceFingerprint");
CREATE INDEX "funding_calls_agencyName_programIdentifier_idx" ON "funding_calls"("agencyName", "programIdentifier");

ALTER TABLE "funding_import_jobs"
  ALTER COLUMN "tenantId" DROP NOT NULL,
  ADD COLUMN "visibility" "FundingVisibility" NOT NULL DEFAULT 'TENANT_PRIVATE',
  ADD COLUMN "outcome" "FundingImportOutcome",
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "duplicateCandidatesJson" JSONB,
  ADD COLUMN "normalizedFactsJson" JSONB,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "funding_import_jobs" DROP CONSTRAINT "funding_import_jobs_tenantId_fkey";
ALTER TABLE "funding_import_jobs"
  ADD CONSTRAINT "funding_import_jobs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "funding_import_assets" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fundingCallId" TEXT,
    "kind" "FundingImportAssetKind" NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "storagePath" TEXT,
    "textContent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_import_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funding_import_assets_jobId_kind_idx" ON "funding_import_assets"("jobId", "kind");
CREATE INDEX "funding_import_assets_fundingCallId_idx" ON "funding_import_assets"("fundingCallId");

ALTER TABLE "funding_import_assets"
  ADD CONSTRAINT "funding_import_assets_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "funding_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_import_assets"
  ADD CONSTRAINT "funding_import_assets_fundingCallId_fkey"
  FOREIGN KEY ("fundingCallId") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
