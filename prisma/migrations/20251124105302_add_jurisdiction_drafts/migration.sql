-- AlterTable
ALTER TABLE "annexure_drafts" ADD COLUMN     "jurisdiction" TEXT NOT NULL DEFAULT 'IN';

-- AlterTable
ALTER TABLE "drafting_sessions" ADD COLUMN     "jurisdictionDraftStatus" JSONB;
