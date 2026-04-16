-- Two-Pass Section Generation Pipeline
-- Adds support for background Pass 1 (evidence-grounded draft) and Pass 2 (publication polish)
-- Pass 1 preserves [CITE:key] anchors; Pass 2 polishes prose while retaining all citations

-- Add new enum values to PaperSectionStatus
-- PREPARING  = Pass 1 in progress (background pre-generation)
-- BASE_READY = Pass 1 complete, awaiting Pass 2 polish
-- POLISHING  = Pass 2 in progress
ALTER TYPE "PaperSectionStatus" ADD VALUE IF NOT EXISTS 'PREPARING' BEFORE 'DRAFT';
ALTER TYPE "PaperSectionStatus" ADD VALUE IF NOT EXISTS 'BASE_READY' BEFORE 'DRAFT';
ALTER TYPE "PaperSectionStatus" ADD VALUE IF NOT EXISTS 'POLISHING' BEFORE 'DRAFT';

-- Add two-pass fields to paper_sections
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "generation_mode" TEXT NOT NULL DEFAULT 'single_pass';
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "base_content_internal" TEXT;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "base_memory" JSONB;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass1_prompt_used" TEXT;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass1_llm_response" TEXT;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass1_tokens_used" INTEGER;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass1_completed_at" TIMESTAMP(3);
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass2_prompt_used" TEXT;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass2_tokens_used" INTEGER;
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "pass2_completed_at" TIMESTAMP(3);
ALTER TABLE "paper_sections" ADD COLUMN IF NOT EXISTS "validation_report" JSONB;

-- Add background generation tracking to drafting_sessions
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "bg_gen_status" TEXT;
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "bg_gen_started_at" TIMESTAMP(3);
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "bg_gen_completed_at" TIMESTAMP(3);
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "bg_gen_progress" JSONB;
