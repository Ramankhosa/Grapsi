-- Seed Grant Prep entitlement data without changing existing production settings.
-- This is intentionally additive and idempotent.

INSERT INTO "features" ("id", "code", "name", "unit")
VALUES ('feature_grant_prep', 'GRANT_PREP'::"FeatureCode", 'Grant Prep', 'sessions')
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "unit" = EXCLUDED."unit";

INSERT INTO "llm_model_classes" ("id", "code", "name")
VALUES ('model_class_base_m', 'BASE_M'::"ModelClass", 'Base Medium')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "tasks" ("id", "code", "name", "linkedFeatureId")
SELECT 'task_grant_prep_chat', 'GRANT_PREP_CHAT'::"TaskCode", 'Grant Prep Chat', "id"
FROM "features"
WHERE "code" = 'GRANT_PREP'::"FeatureCode"
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "linkedFeatureId" = EXCLUDED."linkedFeatureId";

INSERT INTO "tasks" ("id", "code", "name", "linkedFeatureId")
SELECT 'task_grant_blueprint_generate', 'GRANT_BLUEPRINT_GENERATE'::"TaskCode", 'Grant Blueprint Generate', "id"
FROM "features"
WHERE "code" = 'GRANT_PREP'::"FeatureCode"
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "linkedFeatureId" = EXCLUDED."linkedFeatureId";

WITH grant_feature AS (
  SELECT "id"
  FROM "features"
  WHERE "code" = 'GRANT_PREP'::"FeatureCode"
),
funding_plan_features AS (
  SELECT
    pf."planId",
    pf."monthlyQuota",
    pf."dailyQuota",
    pf."monthlyTokenLimit",
    pf."dailyTokenLimit"
  FROM "plan_features" pf
  JOIN "features" f ON f."id" = pf."featureId"
  WHERE f."code" = 'FUNDING_DISCOVERY'::"FeatureCode"
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
  'plan_feature_grant_prep_' || p."id",
  p."id",
  gf."id",
  COALESCE(
    fpf."monthlyQuota",
    CASE
      WHEN p."code" ILIKE '%FREE%' THEN 250
      WHEN p."code" ILIKE '%PRO%' THEN 2500
      ELSE NULL
    END
  ),
  COALESCE(
    fpf."dailyQuota",
    CASE
      WHEN p."code" ILIKE '%FREE%' THEN 25
      WHEN p."code" ILIKE '%PRO%' THEN 250
      ELSE NULL
    END
  ),
  fpf."monthlyTokenLimit",
  fpf."dailyTokenLimit"
FROM "plans" p
CROSS JOIN grant_feature gf
LEFT JOIN funding_plan_features fpf ON fpf."planId" = p."id"
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
),
grant_tasks AS (
  SELECT 'GRANT_PREP_CHAT'::"TaskCode" AS "taskCode"
  UNION ALL
  SELECT 'GRANT_BLUEPRINT_GENERATE'::"TaskCode" AS "taskCode"
)
INSERT INTO "plan_llm_access" (
  "id",
  "planId",
  "taskCode",
  "allowedClasses",
  "defaultClassId"
)
SELECT
  'plan_llm_access_' || lower(gt."taskCode"::text) || '_' || p."id",
  p."id",
  gt."taskCode",
  COALESCE(fa."allowedClasses", '["BASE_M"]'),
  COALESCE(fa."defaultClassId", bmc."id")
FROM "plans" p
CROSS JOIN grant_tasks gt
CROSS JOIN base_model_class bmc
LEFT JOIN funding_access fa ON fa."planId" = p."id"
WHERE p."status" = 'ACTIVE'::"PlanStatus"
ON CONFLICT ("planId", "taskCode") DO NOTHING;
