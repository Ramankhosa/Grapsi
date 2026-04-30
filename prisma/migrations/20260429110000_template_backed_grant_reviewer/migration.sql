-- Template-backed reviewer integration.

ALTER TYPE "CallInputType" ADD VALUE IF NOT EXISTS 'template';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewerMode') THEN
    CREATE TYPE "ReviewerMode" AS ENUM ('standalone', 'grant_integrated');
  END IF;
END $$;

ALTER TABLE "reviewer_calls"
  ADD COLUMN IF NOT EXISTS "reviewerMode" "ReviewerMode" NOT NULL DEFAULT 'standalone',
  ADD COLUMN IF NOT EXISTS "templateSnapshotJson" JSONB,
  ADD COLUMN IF NOT EXISTS "manualRubricJson" JSONB,
  ADD COLUMN IF NOT EXISTS "rulesSource" TEXT NOT NULL DEFAULT 'template_manual',
  ADD COLUMN IF NOT EXISTS "sourceTemplateRevisionId" TEXT;

ALTER TABLE "reviewer_sections"
  ADD COLUMN IF NOT EXISTS "sourceHash" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceStale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reviewerBucketKey" TEXT,
  ADD COLUMN IF NOT EXISTS "mappingJson" JSONB;

CREATE TABLE IF NOT EXISTS "reviewer_section_grant_links" (
  "id" TEXT NOT NULL,
  "reviewerSectionId" TEXT NOT NULL,
  "reviewerCallId" TEXT NOT NULL,
  "grantSessionId" TEXT NOT NULL,
  "grantSectionDraftId" TEXT,
  "grantSectionKey" TEXT NOT NULL,
  "grantSectionLabel" TEXT NOT NULL,
  "sourceContentHash" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reviewer_section_grant_links_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviewer_section_grant_links_reviewerSectionId_fkey'
  ) THEN
    ALTER TABLE "reviewer_section_grant_links"
      ADD CONSTRAINT "reviewer_section_grant_links_reviewerSectionId_fkey"
      FOREIGN KEY ("reviewerSectionId") REFERENCES "reviewer_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviewer_section_grant_links_reviewerCallId_fkey'
  ) THEN
    ALTER TABLE "reviewer_section_grant_links"
      ADD CONSTRAINT "reviewer_section_grant_links_reviewerCallId_fkey"
      FOREIGN KEY ("reviewerCallId") REFERENCES "reviewer_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviewer_section_grant_links_grantSessionId_fkey'
  ) THEN
    ALTER TABLE "reviewer_section_grant_links"
      ADD CONSTRAINT "reviewer_section_grant_links_grantSessionId_fkey"
      FOREIGN KEY ("grantSessionId") REFERENCES "grant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviewer_section_grant_links_grantSectionDraftId_fkey'
  ) THEN
    ALTER TABLE "reviewer_section_grant_links"
      ADD CONSTRAINT "reviewer_section_grant_links_grantSectionDraftId_fkey"
      FOREIGN KEY ("grantSectionDraftId") REFERENCES "grant_section_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reviewer_calls_reviewerMode_idx" ON "reviewer_calls"("reviewerMode");
CREATE INDEX IF NOT EXISTS "reviewer_calls_sourceTemplateRevisionId_idx" ON "reviewer_calls"("sourceTemplateRevisionId");
CREATE INDEX IF NOT EXISTS "reviewer_sections_call_id_reviewerBucketKey_idx" ON "reviewer_sections"("call_id", "reviewerBucketKey");
CREATE INDEX IF NOT EXISTS "reviewer_sections_sourceStale_idx" ON "reviewer_sections"("sourceStale");
CREATE INDEX IF NOT EXISTS "reviewer_section_grant_links_reviewerCallId_idx" ON "reviewer_section_grant_links"("reviewerCallId");
CREATE INDEX IF NOT EXISTS "reviewer_section_grant_links_reviewerSectionId_order_idx" ON "reviewer_section_grant_links"("reviewerSectionId", "order");
CREATE INDEX IF NOT EXISTS "reviewer_section_grant_links_grantSessionId_grantSectionKey_idx" ON "reviewer_section_grant_links"("grantSessionId", "grantSectionKey");
CREATE INDEX IF NOT EXISTS "reviewer_section_grant_links_grantSectionDraftId_idx" ON "reviewer_section_grant_links"("grantSectionDraftId");
CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_section_grant_links_one_active_section_idx"
  ON "reviewer_section_grant_links"("grantSessionId", "grantSectionKey")
  WHERE "isActive" = true;
