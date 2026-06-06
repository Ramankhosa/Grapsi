-- Enable grant section drafting for existing default entitlements.
-- This is additive and preserves any plan-specific grant drafting rows already configured.

INSERT INTO "features" ("id", "code", "name", "unit")
VALUES ('feature_grant_drafting', 'GRANT_DRAFTING'::"FeatureCode", 'Grant Drafting', 'tokens')
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "unit" = EXCLUDED."unit";

INSERT INTO "tasks" ("id", "code", "name", "linkedFeatureId")
SELECT 'task_grant_section_generate', 'GRANT_SECTION_GENERATE'::"TaskCode", 'Grant Section Generation', "id"
FROM "features"
WHERE "code" = 'GRANT_DRAFTING'::"FeatureCode"
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "linkedFeatureId" = EXCLUDED."linkedFeatureId";

INSERT INTO "llm_model_classes" ("id", "code", "name")
VALUES ('model_class_base_m', 'BASE_M'::"ModelClass", 'Base Medium')
ON CONFLICT ("code") DO NOTHING;

WITH grant_feature AS (
  SELECT "id"
  FROM "features"
  WHERE "code" = 'GRANT_DRAFTING'::"FeatureCode"
)
INSERT INTO "plan_features" (
  "id",
  "planId",
  "featureId",
  "monthlyQuota",
  "dailyQuota",
  "monthlyTokenLimit",
  "dailyTokenLimit"
)
SELECT
  'plan_feature_grant_drafting_' || p."id",
  p."id",
  gf."id",
  CASE
    WHEN p."code" ILIKE '%FREE%' THEN 25
    WHEN p."code" ILIKE '%PRO%' THEN 250
    ELSE NULL
  END,
  CASE
    WHEN p."code" ILIKE '%FREE%' THEN 5
    WHEN p."code" ILIKE '%PRO%' THEN 50
    ELSE NULL
  END,
  CASE
    WHEN p."code" ILIKE '%FREE%' THEN 500000
    WHEN p."code" ILIKE '%PRO%' THEN 5000000
    ELSE NULL
  END,
  CASE
    WHEN p."code" ILIKE '%FREE%' THEN 50000
    WHEN p."code" ILIKE '%PRO%' THEN 500000
    ELSE NULL
  END
FROM "plans" p
CROSS JOIN grant_feature gf
WHERE p."status" = 'ACTIVE'::"PlanStatus"
ON CONFLICT ("planId", "featureId") DO NOTHING;

WITH base_model_class AS (
  SELECT "id"
  FROM "llm_model_classes"
  WHERE "code" = 'BASE_M'::"ModelClass"
),
funding_access AS (
  SELECT
    "planId",
    "allowedClasses",
    "defaultClassId"
  FROM "plan_llm_access"
  WHERE "taskCode" = 'FUNDING_CHAT'::"TaskCode"
)
INSERT INTO "plan_llm_access" (
  "id",
  "planId",
  "taskCode",
  "allowedClasses",
  "defaultClassId"
)
SELECT
  'plan_llm_access_grant_section_generate_' || p."id",
  p."id",
  'GRANT_SECTION_GENERATE'::"TaskCode",
  COALESCE(fa."allowedClasses", '["BASE_M"]'),
  COALESCE(fa."defaultClassId", bmc."id")
FROM "plans" p
CROSS JOIN base_model_class bmc
LEFT JOIN funding_access fa ON fa."planId" = p."id"
WHERE p."status" = 'ACTIVE'::"PlanStatus"
ON CONFLICT ("planId", "taskCode") DO NOTHING;
