-- Dedicated storage for paper drafting workflow state and Pass 1 artifacts.
-- This separates structured drafting state from validation_report and gives
-- Pass 1 output a first-class persistence slot.

ALTER TABLE "paper_sections"
  ADD COLUMN IF NOT EXISTS "pass1_artifact" JSONB,
  ADD COLUMN IF NOT EXISTS "dimension_flow_state" JSONB;

-- Backfill structured dimension flow state from the legacy validation_report shape.
UPDATE "paper_sections"
SET "dimension_flow_state" = "validation_report" -> 'dimensionFlow'
WHERE "dimension_flow_state" IS NULL
  AND "validation_report" IS NOT NULL
  AND jsonb_typeof("validation_report") = 'object'
  AND "validation_report" ? 'dimensionFlow';

-- Backfill Pass 1 artifacts from existing two-pass/base fields.
UPDATE "paper_sections"
SET "pass1_artifact" = jsonb_strip_nulls(
  jsonb_build_object(
    'version', 1,
    'content', "base_content_internal",
    'memory', COALESCE("base_memory", 'null'::jsonb),
    'contentFingerprint', md5("base_content_internal"),
    'wordCount',
      CASE
        WHEN "base_content_internal" IS NULL OR btrim("base_content_internal") = '' THEN 0
        ELSE COALESCE(
          array_length(
            regexp_split_to_array(
              regexp_replace(btrim("base_content_internal"), '\s+', ' ', 'g'),
              '\s+'
            ),
            1
          ),
          0
        )
      END,
    'generatedAt', to_jsonb("pass1_completed_at"),
    'promptUsed', "pass1_prompt_used",
    'tokensUsed', "pass1_tokens_used"
  )
)
WHERE "pass1_artifact" IS NULL
  AND "base_content_internal" IS NOT NULL
  AND btrim("base_content_internal") <> '';
