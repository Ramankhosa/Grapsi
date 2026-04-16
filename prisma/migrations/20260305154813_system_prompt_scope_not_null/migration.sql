/*
  Warnings:

  - Made the column `section_scope` on table `system_prompt_templates` required. This step will fail if there are existing NULL values in that column.
  - Made the column `paper_type_scope` on table `system_prompt_templates` required. This step will fail if there are existing NULL values in that column.

*/
-- Backfill NULLs before adding NOT NULL constraint
UPDATE "system_prompt_templates" SET "section_scope" = '*' WHERE "section_scope" IS NULL;
UPDATE "system_prompt_templates" SET "paper_type_scope" = '*' WHERE "paper_type_scope" IS NULL;

-- AlterTable
ALTER TABLE "system_prompt_templates" ALTER COLUMN "section_scope" SET NOT NULL,
ALTER COLUMN "section_scope" SET DEFAULT '*',
ALTER COLUMN "paper_type_scope" SET NOT NULL,
ALTER COLUMN "paper_type_scope" SET DEFAULT '*';
