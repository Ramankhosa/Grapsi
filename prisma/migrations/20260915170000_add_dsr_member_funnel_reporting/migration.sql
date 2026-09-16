CREATE TABLE "funding_opportunity_matches" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "org_unit_id" TEXT,
  "school_id" TEXT,
  "match_score" DOUBLE PRECISION,
  "match_tier" TEXT,
  "match_reason" TEXT,
  "source" TEXT NOT NULL,
  "source_version" TEXT,
  "inferred" BOOLEAN NOT NULL DEFAULT false,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_opportunity_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "funding_opportunity_matches_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "funding_opportunity_matches_call_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE,
  CONSTRAINT "funding_opportunity_matches_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "funding_opportunity_matches_unit_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE SET NULL,
  CONSTRAINT "funding_opportunity_matches_school_fkey" FOREIGN KEY ("school_id") REFERENCES "tenant_org_units"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "funding_opportunity_matches_identity_key"
  ON "funding_opportunity_matches"("tenant_id", "funding_call_id", "user_id", "school_id") NULLS NOT DISTINCT;
CREATE INDEX "idx_funding_opportunity_matches_school_seen"
  ON "funding_opportunity_matches"("tenant_id", "school_id", "first_seen_at");
CREATE INDEX "idx_funding_opportunity_matches_call"
  ON "funding_opportunity_matches"("tenant_id", "funding_call_id");
CREATE INDEX "idx_funding_opportunity_matches_user"
  ON "funding_opportunity_matches"("tenant_id", "user_id");

ALTER TABLE "call_assignments"
  ADD COLUMN "submission_recorded_by_user_id" TEXT,
  ADD COLUMN "submission_evidence_status" TEXT;
ALTER TABLE "call_assignments"
  ADD CONSTRAINT "call_assignments_submission_recorder_fkey"
  FOREIGN KEY ("submission_recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX "idx_call_assignments_submission_recorder"
  ON "call_assignments"("submission_recorded_by_user_id", "submitted_at");

ALTER TABLE "grant_proposals"
  ADD COLUMN "submission_recorded_by_user_id" TEXT,
  ADD COLUMN "submission_evidence_status" TEXT;
ALTER TABLE "grant_proposals"
  ADD CONSTRAINT "grant_proposals_submission_recorder_fkey"
  FOREIGN KEY ("submission_recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX "idx_grant_proposals_submission_recorder"
  ON "grant_proposals"("submission_recorded_by_user_id", "submitted_at");

UPDATE "call_assignments"
SET "submission_evidence_status" = CASE
  WHEN "submission_reference" IS NOT NULL AND "submission_url" IS NOT NULL THEN 'MIXED'
  WHEN "submission_reference" IS NOT NULL THEN 'REFERENCE'
  WHEN "submission_url" IS NOT NULL THEN 'URL'
  WHEN "submission_notes" IS NOT NULL THEN 'NOTE'
  ELSE 'MISSING'
END
WHERE "submitted_at" IS NOT NULL;

UPDATE "grant_proposals"
SET "submission_evidence_status" = CASE
  WHEN "submission_reference" IS NOT NULL AND "submission_url" IS NOT NULL THEN 'MIXED'
  WHEN "submission_reference" IS NOT NULL THEN 'REFERENCE'
  WHEN "submission_url" IS NOT NULL THEN 'URL'
  ELSE 'MISSING'
END
WHERE "submitted_at" IS NOT NULL;

-- Historical rows are recoverable from alerts, shortlists and assignments,
-- but are labelled inferred because the old matcher denominator was not saved.
INSERT INTO "funding_opportunity_matches" (
  "id", "tenant_id", "funding_call_id", "user_id", "org_unit_id", "school_id",
  "match_score", "match_tier", "match_reason", "source", "source_version",
  "inferred", "first_seen_at", "last_seen_at", "created_at", "updated_at"
)
SELECT
  'fom_' || md5(x.tenant_id || ':' || x.funding_call_id || ':' || x.user_id || ':' || COALESCE(x.school_id, '')),
  x.tenant_id, x.funding_call_id, x.user_id, x.org_unit_id, x.school_id,
  x.match_score, x.match_tier, x.match_reason, x.source, 'historical-v1', true,
  x.first_seen_at, x.first_seen_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (s.tenant_id, s.funding_call_id, s.user_id, s.school_id) s.*
  FROM (
    SELECT a.tenant_id, a.funding_call_id, a.user_id, rp.org_unit_id,
           u.path[1] AS school_id, a.match_score, a.match_tier, a.match_reason,
           'alert'::text AS source, a.created_at AS first_seen_at, 1 AS priority
      FROM funding_call_alerts a
      LEFT JOIN researcher_profiles rp ON rp.user_id = a.user_id
      LEFT JOIN tenant_org_units u ON u.id = rp.org_unit_id
     WHERE a.tenant_id IS NOT NULL
    UNION ALL
    SELECT c.tenant_id, c.funding_call_id, c.user_id, rp.org_unit_id,
           u.path[1], c.match_score, c.match_tier, NULL::text,
           'candidate'::text, c.created_at, 2
      FROM call_candidates c
      LEFT JOIN researcher_profiles rp ON rp.user_id = c.user_id
      LEFT JOIN tenant_org_units u ON u.id = rp.org_unit_id
    UNION ALL
    SELECT ca.tenant_id, ca.funding_call_id, ca.assignee_user_id,
           ca.assignee_org_unit_id, u.path[1], ca.match_score, ca.match_tier,
           ca.match_basis, 'assignment'::text, ca.created_at, 3
      FROM call_assignments ca
      LEFT JOIN tenant_org_units u ON u.id = ca.assignee_org_unit_id
  ) s
  ORDER BY s.tenant_id, s.funding_call_id, s.user_id, s.school_id, s.priority DESC
) x
ON CONFLICT ("tenant_id", "funding_call_id", "user_id", "school_id") DO NOTHING;
