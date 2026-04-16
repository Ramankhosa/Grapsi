-- AlterTable
ALTER TABLE "drafting_sessions" ADD COLUMN     "activeJurisdiction" TEXT,
ADD COLUMN     "draftingJurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[];
