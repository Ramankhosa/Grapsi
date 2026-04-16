-- Add include/exclude review controls for citation-to-dimension mappings

CREATE TYPE "CitationMappingInclusionStatus" AS ENUM ('INCLUDED', 'EXCLUDED');

ALTER TABLE "citation_usages"
  ADD COLUMN "inclusionStatus" "CitationMappingInclusionStatus" NOT NULL DEFAULT 'INCLUDED',
  ADD COLUMN "reviewComment" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT;
