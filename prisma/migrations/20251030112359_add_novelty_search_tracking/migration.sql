-- AlterEnum
ALTER TYPE "TaskCode" ADD VALUE 'LLM6_REPORT_GENERATION';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "noveltySearchesCompleted" INTEGER NOT NULL DEFAULT 0;
