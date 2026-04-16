-- CreateEnum
CREATE TYPE "CitationUsageKind" AS ENUM ('DRAFT_CITATION', 'DIMENSION_MAPPING');

-- AlterTable: citations identity and provider-link fields
ALTER TABLE "citations"
  ADD COLUMN "importProvider" TEXT,
  ADD COLUMN "importProviderPaperId" TEXT,
  ADD COLUMN "doiNormalized" TEXT,
  ADD COLUMN "titleFingerprint" TEXT,
  ADD COLUMN "firstAuthorNormalized" TEXT,
  ADD COLUMN "paperIdentityKey" TEXT;

-- AlterTable: citation_usages usage kind discriminator
ALTER TABLE "citation_usages"
  ADD COLUMN "usageKind" "CitationUsageKind" NOT NULL DEFAULT 'DRAFT_CITATION';

-- Backfill mapping rows to DIMENSION_MAPPING for existing data
UPDATE "citation_usages"
SET "usageKind" = 'DIMENSION_MAPPING'
WHERE "dimension" IS NOT NULL;

-- Indexes for citation identity lookup
CREATE INDEX "citations_sessionId_doiNormalized_idx" ON "citations"("sessionId", "doiNormalized");
CREATE INDEX "citations_sessionId_paperIdentityKey_idx" ON "citations"("sessionId", "paperIdentityKey");
CREATE INDEX "citations_sessionId_importProvider_importProviderPaperId_idx" ON "citations"("sessionId", "importProvider", "importProviderPaperId");

-- Indexes and uniqueness for usage kind separation
CREATE INDEX "citation_usages_citationId_usageKind_idx" ON "citation_usages"("citationId", "usageKind");
CREATE INDEX "citation_usages_sectionKey_usageKind_idx" ON "citation_usages"("sectionKey", "usageKind");
CREATE UNIQUE INDEX "citation_usage_dim_map_uniq" ON "citation_usages"("citationId", "sectionKey", "dimension", "usageKind");
