-- Passing a call on after a decline, and the shortlist that leads up to an
-- assignment in the first place.

-- 1. The reassignment chain. Unique because a record can only be superseded
--    once, which makes "asked A, asked B, asked C" a list rather than a tree.
ALTER TABLE "call_assignments" ADD COLUMN "previous_assignment_id" TEXT;

CREATE UNIQUE INDEX "call_assignments_previous_assignment_id_key"
  ON "call_assignments"("previous_assignment_id");

ALTER TABLE "call_assignments"
  ADD CONSTRAINT "call_assignments_previous_assignment_id_fkey"
  FOREIGN KEY ("previous_assignment_id") REFERENCES "call_assignments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Candidates: everyone considered for a call, whether or not they were
--    assigned it. status is TEXT rather than an enum so a new state needs no
--    migration, matching assignment_follow_ups.kind.
CREATE TABLE "call_candidates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SHORTLISTED',
  "note" TEXT,
  "match_score" DOUBLE PRECISION,
  "match_tier" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "call_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_candidates_call_user_key"
  ON "call_candidates"("funding_call_id", "user_id");
CREATE INDEX "idx_call_candidates_tenant_call"
  ON "call_candidates"("tenant_id", "funding_call_id");
CREATE INDEX "idx_call_candidates_tenant_user"
  ON "call_candidates"("tenant_id", "user_id");

ALTER TABLE "call_candidates"
  ADD CONSTRAINT "call_candidates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_candidates"
  ADD CONSTRAINT "call_candidates_funding_call_id_fkey"
  FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_candidates"
  ADD CONSTRAINT "call_candidates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_candidates"
  ADD CONSTRAINT "call_candidates_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
