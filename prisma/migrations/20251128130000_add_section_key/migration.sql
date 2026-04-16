-- Add section_key column
ALTER TABLE "country_section_mappings" ADD COLUMN IF NOT EXISTS "section_key" TEXT;

-- Populate section_key based on superset_code
UPDATE "country_section_mappings"
SET "section_key" = CASE "superset_code"
  WHEN '01. Title' THEN 'title'
  WHEN '02. Preamble' THEN 'preamble'
  WHEN '03. Cross-Ref/Fed' THEN 'crossReference'
  WHEN '04. Tech Field' THEN 'fieldOfInvention'
  WHEN '05. Background' THEN 'background'
  WHEN '06. Objects' THEN 'objectsOfInvention'
  WHEN '07. Summary (Gen)' THEN 'summary'
  WHEN '07a. Tech Problem' THEN 'technicalProblem'
  WHEN '07b. Tech Solution' THEN 'technicalSolution'
  WHEN '07c. Effects' THEN 'advantageousEffects'
  WHEN '08. Drawings' THEN 'briefDescriptionOfDrawings'
  WHEN '09. Detailed Desc' THEN 'detailedDescription'
  WHEN '10. Best Mode' THEN 'bestMethod'
  WHEN '11. Ind. Applicability' THEN 'industrialApplicability'
  WHEN '12. Claims' THEN 'claims'
  WHEN '13. Abstract' THEN 'abstract'
  ELSE NULL
END
WHERE "section_key" IS NULL;

-- Ensure no NULLs remain (fall back to superset_code sanitized if needed)
UPDATE "country_section_mappings"
SET "section_key" = regexp_replace(lower("superset_code"), '[^a-z0-9]+', '', 'g')
WHERE "section_key" IS NULL;

ALTER TABLE "country_section_mappings" ALTER COLUMN "section_key" SET NOT NULL;

-- Add unique index to prevent duplicates per country/section_key
CREATE UNIQUE INDEX IF NOT EXISTS "country_section_mappings_country_section_key"
  ON "country_section_mappings" ("country_code", "section_key");
