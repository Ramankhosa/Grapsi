-- Add context injection flags to superset_sections table
-- These flags determine what data to inject into section prompts during draft generation

ALTER TABLE "superset_sections" ADD COLUMN IF NOT EXISTS "requires_prior_art" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "superset_sections" ADD COLUMN IF NOT EXISTS "requires_figures" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "superset_sections" ADD COLUMN IF NOT EXISTS "requires_claims" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "superset_sections" ADD COLUMN IF NOT EXISTS "requires_components" BOOLEAN NOT NULL DEFAULT false;

-- Add country-specific overrides to country_section_mappings table
-- null = use SupersetSection default, true/false = override for this jurisdiction

ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "requires_prior_art_override" BOOLEAN;
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "requires_figures_override" BOOLEAN;
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "requires_claims_override" BOOLEAN;
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "requires_components_override" BOOLEAN;

-- Set default values based on section semantics
-- These match the values in MasterSeed.js SUPERSET_SECTIONS

UPDATE "superset_sections" SET "requires_prior_art" = true WHERE "section_key" IN ('background', 'crossReference', 'objectsOfInvention', 'technicalProblem');
UPDATE "superset_sections" SET "requires_figures" = true WHERE "section_key" IN ('briefDescriptionOfDrawings', 'detailedDescription', 'bestMode', 'abstract');
UPDATE "superset_sections" SET "requires_claims" = true WHERE "section_key" IN ('summary', 'technicalSolution', 'detailedDescription', 'abstract');
UPDATE "superset_sections" SET "requires_components" = true WHERE "section_key" IN ('summary', 'technicalSolution', 'detailedDescription', 'bestMode', 'claims', 'listOfNumerals');
