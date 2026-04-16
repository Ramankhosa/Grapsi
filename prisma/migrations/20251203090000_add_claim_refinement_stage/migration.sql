-- AlterEnum
ALTER TYPE "DraftingSessionStatus" ADD VALUE IF NOT EXISTS 'CLAIM_REFINEMENT';

-- Add prior art config storage
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "prior_art_config" JSONB;
