/*
  This migration creates the superset_sections table and updates related tables.
  Made idempotent with IF NOT EXISTS/IF EXISTS checks.
*/

-- CreateEnum (skip if already exists - created in previous migration)
DO $$ BEGIN
    CREATE TYPE "CountrySectionPromptStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable country_names (make timestamp columns consistent)
ALTER TABLE "country_names" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);
DO $$ BEGIN
    ALTER TABLE "country_names" ALTER COLUMN "updated_at" DROP DEFAULT;
EXCEPTION
    WHEN others THEN null;
END $$;
ALTER TABLE "country_names" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable country_section_mappings
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "display_order" INTEGER;
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "is_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "is_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "country_section_mappings" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);
DO $$ BEGIN
    ALTER TABLE "country_section_mappings" ALTER COLUMN "updated_at" DROP DEFAULT;
EXCEPTION
    WHEN others THEN null;
END $$;
ALTER TABLE "country_section_mappings" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- NOTE: country_section_prompts.status is already created with the correct enum type in previous migration
-- No need to DROP and ADD the column

-- CreateTable superset_sections
CREATE TABLE IF NOT EXISTS "superset_sections" (
    "id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "display_order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "superset_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "superset_sections_section_key_key" ON "superset_sections"("section_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "superset_sections_display_order_idx" ON "superset_sections"("display_order");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "superset_sections_is_active_idx" ON "superset_sections"("is_active");

-- CreateIndex (if not already exists)
CREATE INDEX IF NOT EXISTS "country_section_mappings_country_code_idx" ON "country_section_mappings"("country_code");

-- CreateIndex (if not already exists)
CREATE INDEX IF NOT EXISTS "country_section_mappings_section_key_idx" ON "country_section_mappings"("section_key");

-- Note: Index renames are no longer needed because the previous migration 
-- (20251129000000_add_section_prompts) now creates indexes with the correct names already.
-- The old rename operations have been removed to prevent errors.
