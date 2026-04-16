-- AlterTable: Add aiMeta JSON field to citations table
-- This field stores AI-generated citation metadata for section generation
-- Contains: keyContribution, keyFindings, methodologicalApproach, 
-- relevanceToResearch, limitationsOrGaps, usage (intro/litReview/methodology/comparison)

ALTER TABLE "citations" ADD COLUMN "aiMeta" JSONB;

-- Add comment for documentation
COMMENT ON COLUMN "citations"."aiMeta" IS 'AI-generated citation metadata for section generation. Contains keyContribution, keyFindings, usage flags (I/L/M/C), etc.';

