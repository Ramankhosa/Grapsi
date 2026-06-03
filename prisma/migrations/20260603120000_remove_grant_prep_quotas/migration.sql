-- Grant Prep chat remains entitlement-gated and metered for usage/cost,
-- but it should not be blocked by plan quota limits.

UPDATE "plan_features" pf
SET
  "monthlyQuota" = NULL,
  "dailyQuota" = NULL,
  "monthlyTokenLimit" = NULL,
  "dailyTokenLimit" = NULL
FROM "features" f
WHERE f."id" = pf."featureId"
  AND f."code" = 'GRANT_PREP'::"FeatureCode";
