-- ============================================================================
-- PAPER SUPERSET SECTION SYSTEM
-- Admin-configurable prompts for academic papers
-- Mirrors SupersetSection/CountrySectionPrompt pattern for patents
-- ============================================================================

-- Create enum for prompt status
CREATE TYPE "PaperTypeSectionPromptStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- Base section definitions for academic papers
CREATE TABLE "paper_superset_sections" (
    "id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_blueprint" BOOLEAN NOT NULL DEFAULT true,
    "requires_previous_sections" BOOLEAN NOT NULL DEFAULT true,
    "requires_citations" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_superset_sections_pkey" PRIMARY KEY ("id")
);

-- Paper-type-specific prompt overrides
CREATE TABLE "paper_type_section_prompts" (
    "id" TEXT NOT NULL,
    "paper_type_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "additions" JSONB DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PaperTypeSectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_type_section_prompts_pkey" PRIMARY KEY ("id")
);

-- Audit trail for paper prompt changes
CREATE TABLE "paper_type_section_prompt_history" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "paper_type_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "additions" JSONB DEFAULT '[]',
    "version" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "change_reason" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_type_section_prompt_history_pkey" PRIMARY KEY ("id")
);

-- Create unique constraints
CREATE UNIQUE INDEX "paper_superset_sections_section_key_key" ON "paper_superset_sections"("section_key");
CREATE UNIQUE INDEX "paper_type_section_unique" ON "paper_type_section_prompts"("paper_type_code", "section_key");

-- Create indexes
CREATE INDEX "paper_superset_sections_display_order_idx" ON "paper_superset_sections"("display_order");
CREATE INDEX "paper_superset_sections_is_active_idx" ON "paper_superset_sections"("is_active");
CREATE INDEX "paper_type_section_prompts_paper_type_code_idx" ON "paper_type_section_prompts"("paper_type_code");
CREATE INDEX "paper_type_section_prompts_section_key_idx" ON "paper_type_section_prompts"("section_key");
CREATE INDEX "paper_type_section_prompts_status_idx" ON "paper_type_section_prompts"("status");
CREATE INDEX "paper_type_section_prompt_history_prompt_id_idx" ON "paper_type_section_prompt_history"("prompt_id");
CREATE INDEX "paper_type_section_prompt_history_paper_type_code_section_key_idx" ON "paper_type_section_prompt_history"("paper_type_code", "section_key");

-- Add foreign key constraints
ALTER TABLE "paper_type_section_prompts" ADD CONSTRAINT "paper_type_section_prompts_section_key_fkey" FOREIGN KEY ("section_key") REFERENCES "paper_superset_sections"("section_key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paper_type_section_prompt_history" ADD CONSTRAINT "paper_type_section_prompt_history_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "paper_type_section_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

