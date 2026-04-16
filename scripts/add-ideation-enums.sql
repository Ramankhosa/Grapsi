-- ============================================================================
-- Add IDEATION to existing enums (Run this BEFORE the ideation migration)
-- Run with: psql -d spotipr -f scripts/add-ideation-enums.sql
-- ============================================================================

-- Add IDEATION to FeatureCode enum
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'IDEATION';

-- Add IDEATION to ServiceType enum
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'IDEATION';

-- Add IDEATION TaskCodes to TaskCode enum
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_NORMALIZE';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_CLASSIFY';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_CONTRADICTION_MAPPING';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_EXPAND';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_OBVIOUSNESS_FILTER';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_GENERATE';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IDEATION_NOVELTY';

-- Verify the enum values were added
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'FeatureCode'::regtype ORDER BY enumsortorder;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'ServiceType'::regtype ORDER BY enumsortorder;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'TaskCode'::regtype ORDER BY enumsortorder;

