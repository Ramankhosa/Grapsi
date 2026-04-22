-- Replace guided/hybrid/express with expert/express for Grant Prep.
CREATE TYPE "GrantPrepEngagementMode_new" AS ENUM ('expert', 'express');

ALTER TABLE "grant_prep_sessions"
  ALTER COLUMN "engagement_mode" DROP DEFAULT,
  ALTER COLUMN "engagement_mode"
  TYPE "GrantPrepEngagementMode_new"
  USING (
    CASE
      WHEN "engagement_mode"::text = 'express' THEN 'express'
      ELSE 'expert'
    END
  )::"GrantPrepEngagementMode_new";

ALTER TABLE "grant_prep_sessions"
  ALTER COLUMN "engagement_mode" SET DEFAULT 'expert';

DROP TYPE "GrantPrepEngagementMode";

ALTER TYPE "GrantPrepEngagementMode_new" RENAME TO "GrantPrepEngagementMode";
