-- AlterTable
ALTER TABLE "paper_blueprints" ADD COLUMN     "intent_lock" JSONB;

-- AlterTable
ALTER TABLE "paper_sections" ADD COLUMN     "argument_plan" JSONB;
