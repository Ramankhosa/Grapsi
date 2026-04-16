-- Phase 1 foundation for Grapsi grant/funding migration:
-- - tenant-bound projects
-- - funding/grant enums and tables
-- - funding/grant service/task enum values
-- - DB-level tenant/visibility invariants

-- Add funding/grant feature and service enum values.
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'FUNDING_DISCOVERY';
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'GRANT_PREP';
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'GRANT_DRAFTING';

ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'FUNDING_DISCOVERY';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'GRANT_PREP';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'GRANT_DRAFTING';

ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'FUNDING_CHAT';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'FUNDING_TEMPLATE_EXTRACT';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'FUNDING_GUIDELINE_EXTRACT';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'GRANT_PREP_CHAT';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'GRANT_BLUEPRINT_GENERATE';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'GRANT_SECTION_GENERATE';

-- Create new enums used by funding and grant tables.
CREATE TYPE "FundingVisibility" AS ENUM ('GLOBAL_PUBLISHED', 'TENANT_PRIVATE');
CREATE TYPE "FundingStatus" AS ENUM ('INGESTING', 'READY_FOR_REVIEW', 'PUBLISHED', 'ARCHIVED', 'FAILED');
CREATE TYPE "FundingSourceType" AS ENUM ('URL', 'FILE', 'TEXT', 'MANUAL');
CREATE TYPE "FundingImportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "FundingRevisionStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'FAILED');
CREATE TYPE "GrantSessionStatus" AS ENUM ('SETUP', 'PREP_OPTIONAL', 'BLUEPRINT', 'DRAFTING', 'REVIEW', 'EXPORT_READY', 'COMPLETED');

-- Make projects tenant-bound using the owning user's tenant.
ALTER TABLE "projects" ADD COLUMN "tenantId" TEXT;

UPDATE "projects" AS p
SET "tenantId" = u."tenantId"
FROM "users" AS u
WHERE p."userId" = u."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "projects" AS p
    LEFT JOIN "users" AS u ON u."id" = p."userId"
    WHERE u."tenantId" IS NULL OR p."tenantId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Project tenantId backfill failed: found project owners without tenantId';
  END IF;
END $$;

ALTER TABLE "projects" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "projects_tenantId_idx" ON "projects"("tenantId");

-- Funding and grant base tables.
CREATE TABLE "funding_calls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "visibility" "FundingVisibility" NOT NULL,
    "status" "FundingStatus" NOT NULL DEFAULT 'INGESTING',
    "title" TEXT NOT NULL,
    "agencyName" TEXT,
    "sourceUrl" TEXT,
    "sourceType" "FundingSourceType" NOT NULL DEFAULT 'URL',
    "extractedFacts" JSONB,
    "normalizedMetadata" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "funding_calls_visibility_tenantId_check" CHECK (
      ("visibility" = 'GLOBAL_PUBLISHED' AND "tenantId" IS NULL) OR
      ("visibility" = 'TENANT_PRIVATE' AND "tenantId" IS NOT NULL)
    )
);

CREATE TABLE "funding_import_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fundingCallId" TEXT,
    "sourceType" "FundingSourceType" NOT NULL,
    "sourceLocator" TEXT,
    "status" "FundingImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB,
    "importMetadata" JSONB,
    "operatorNotes" TEXT,
    "errorMessage" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_call_templates" (
    "id" TEXT NOT NULL,
    "fundingCallId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_call_template_revisions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FundingRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "extractedPayload" JSONB NOT NULL,
    "summaryJson" JSONB,
    "compiledGrantTemplateJson" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_template_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_call_guidelines" (
    "id" TEXT NOT NULL,
    "fundingCallId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_guidelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_call_guideline_revisions" (
    "id" TEXT NOT NULL,
    "guidelineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FundingRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "extractedPayload" JSONB NOT NULL,
    "summaryJson" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_guideline_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "grant_sessions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fundingCallId" TEXT NOT NULL,
    "status" "GrantSessionStatus" NOT NULL DEFAULT 'SETUP',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funding_calls_tenantId_visibility_idx" ON "funding_calls"("tenantId", "visibility");
CREATE INDEX "funding_calls_status_idx" ON "funding_calls"("status");
CREATE INDEX "funding_import_jobs_tenantId_status_idx" ON "funding_import_jobs"("tenantId", "status");
CREATE INDEX "funding_import_jobs_fundingCallId_idx" ON "funding_import_jobs"("fundingCallId");
CREATE UNIQUE INDEX "funding_call_templates_fundingCallId_key" ON "funding_call_templates"("fundingCallId");
CREATE UNIQUE INDEX "funding_call_template_revisions_templateId_version_key" ON "funding_call_template_revisions"("templateId", "version");
CREATE INDEX "funding_call_template_revisions_status_idx" ON "funding_call_template_revisions"("status");
CREATE UNIQUE INDEX "funding_call_guidelines_fundingCallId_key" ON "funding_call_guidelines"("fundingCallId");
CREATE UNIQUE INDEX "funding_call_guideline_revisions_guidelineId_version_key" ON "funding_call_guideline_revisions"("guidelineId", "version");
CREATE INDEX "funding_call_guideline_revisions_status_idx" ON "funding_call_guideline_revisions"("status");
CREATE INDEX "grant_sessions_projectId_status_idx" ON "grant_sessions"("projectId", "status");
CREATE INDEX "grant_sessions_tenantId_idx" ON "grant_sessions"("tenantId");
CREATE INDEX "grant_sessions_fundingCallId_idx" ON "grant_sessions"("fundingCallId");

ALTER TABLE "funding_calls" ADD CONSTRAINT "funding_calls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_import_jobs" ADD CONSTRAINT "funding_import_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_import_jobs" ADD CONSTRAINT "funding_import_jobs_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_call_templates" ADD CONSTRAINT "funding_call_templates_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_call_template_revisions" ADD CONSTRAINT "funding_call_template_revisions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "funding_call_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_call_guidelines" ADD CONSTRAINT "funding_call_guidelines_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_call_guideline_revisions" ADD CONSTRAINT "funding_call_guideline_revisions_guidelineId_fkey" FOREIGN KEY ("guidelineId") REFERENCES "funding_call_guidelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_sessions" ADD CONSTRAINT "grant_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_sessions" ADD CONSTRAINT "grant_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_sessions" ADD CONSTRAINT "grant_sessions_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
