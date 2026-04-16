-- ============================================================================
-- ADD IDEATION ENUM VALUES
-- This migration adds IDEATION values to existing enums before the main
-- ideation engine migration creates tables that reference these values.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction.
-- PostgreSQL 12+ handles this automatically. For older versions, run this
-- migration separately or mark as applied after running manually.
-- ============================================================================

-- Ensure prerequisite enums exist in legacy environments where enum creation
-- happened outside migration history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServiceType') THEN
    CREATE TYPE "ServiceType" AS ENUM (
      'PATENT_DRAFTING',
      'NOVELTY_SEARCH',
      'PRIOR_ART_SEARCH',
      'IDEA_BANK',
      'PERSONA_SYNC',
      'DIAGRAM_GENERATION',
      'PATENT_REVIEW'
    );
  END IF;
END $$;

-- Add IDEATION to FeatureCode enum (used by features table)
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'IDEATION';

-- Add IDEATION to ServiceType enum (used by service access tables)
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'IDEATION';

-- Add IDEATION task codes to TaskCode enum (used by tasks and workflow stages)
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_NORMALIZE';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_CLASSIFY';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_CONTRADICTION_MAPPING';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_EXPAND';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_OBVIOUSNESS_FILTER';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_GENERATE';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_NOVELTY';

