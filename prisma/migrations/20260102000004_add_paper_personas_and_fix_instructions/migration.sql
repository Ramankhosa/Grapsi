-- Migration: Add Paper Writing Personas and fix User Section Instructions
-- This migration:
-- 1. Adds paperTypeCode to UserSectionInstruction for paper-type-specific instructions
-- 2. Creates PaperWritingPersona model (paper equivalent of WritingPersona)
-- 3. Creates PaperWritingSample model (paper equivalent of WritingSample)

-- ============================================================================
-- 1. Update UserSectionInstruction to support paper types
-- ============================================================================

-- Add paperTypeCode column (nullable for backward compatibility)
ALTER TABLE "user_section_instructions"
ADD COLUMN IF NOT EXISTS "paper_type_code" VARCHAR(50);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS "user_section_instructions_paper_type_idx" 
ON "user_section_instructions" ("user_id", "paper_type_code", "section_key");

-- ============================================================================
-- 2. Create PaperWritingPersona model
-- ============================================================================

CREATE TABLE IF NOT EXISTS "paper_writing_personas" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  
  "name" VARCHAR(100) NOT NULL,
  "description" TEXT,
  
  "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
  "is_template" BOOLEAN NOT NULL DEFAULT false,
  "allow_copy" BOOLEAN NOT NULL DEFAULT true,
  
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "paper_writing_personas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paper_writing_personas_creator_name_key" UNIQUE ("created_by", "name")
);

-- Add foreign keys
ALTER TABLE "paper_writing_personas"
ADD CONSTRAINT "paper_writing_personas_tenant_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paper_writing_personas"
ADD CONSTRAINT "paper_writing_personas_creator_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add indexes
CREATE INDEX IF NOT EXISTS "paper_writing_personas_tenant_visibility_idx" 
ON "paper_writing_personas" ("tenant_id", "visibility");

CREATE INDEX IF NOT EXISTS "paper_writing_personas_creator_idx" 
ON "paper_writing_personas" ("created_by");

-- ============================================================================
-- 3. Create PaperWritingSample model
-- ============================================================================

CREATE TABLE IF NOT EXISTS "paper_writing_samples" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "persona_id" TEXT,
  "persona_name" VARCHAR(100) NOT NULL DEFAULT 'Default',
  
  "paper_type_code" VARCHAR(50) NOT NULL,  -- "JOURNAL_ARTICLE", "CONFERENCE_PAPER", "*" (universal)
  "section_key" VARCHAR(50) NOT NULL,       -- "abstract", "introduction", "methodology", etc.
  
  "sample_text" TEXT NOT NULL,              -- User's writing sample (100-300 words)
  "notes" TEXT,                             -- Optional notes about this style
  
  "is_shared" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "word_count" INTEGER NOT NULL DEFAULT 0,
  
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "paper_writing_samples_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paper_writing_samples_unique" UNIQUE ("user_id", "paper_type_code", "persona_id", "section_key")
);

-- Add foreign keys
ALTER TABLE "paper_writing_samples"
ADD CONSTRAINT "paper_writing_samples_user_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paper_writing_samples"
ADD CONSTRAINT "paper_writing_samples_tenant_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paper_writing_samples"
ADD CONSTRAINT "paper_writing_samples_persona_fkey"
FOREIGN KEY ("persona_id") REFERENCES "paper_writing_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes
CREATE INDEX IF NOT EXISTS "paper_writing_samples_tenant_user_idx" 
ON "paper_writing_samples" ("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "paper_writing_samples_user_paper_type_idx" 
ON "paper_writing_samples" ("user_id", "paper_type_code");

CREATE INDEX IF NOT EXISTS "paper_writing_samples_persona_idx" 
ON "paper_writing_samples" ("persona_id");

