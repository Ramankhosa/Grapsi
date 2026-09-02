-- Deputy cover for a school, and a leave window that routes to them.
--
-- Coverage was exactly one officer per school, enforced in the database, with
-- no deputy and no leave. A fortnight's absence meant nobody received that
-- school's nudges, digests or unassigned-call warnings, and nothing said so.

ALTER TABLE "funding_dept_school_assignments"
  ADD COLUMN "is_deputy" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "funding_dept_members"
  ADD COLUMN "away_from" TIMESTAMP(3),
  ADD COLUMN "away_until" TIMESTAMP(3);

-- The primary stays exactly one per school; deputies are unconstrained, so a
-- school can carry a standing backup without the handover being permanent.
DROP INDEX IF EXISTS "funding_dept_school_one_member_key";

CREATE UNIQUE INDEX "funding_dept_school_one_primary_key"
  ON "funding_dept_school_assignments"("tenant_id", "org_unit_id")
  WHERE NOT "is_deputy";

-- One row per (school, member) regardless of role: a member cannot be both the
-- primary and the deputy for the same school.
CREATE UNIQUE INDEX "funding_dept_school_member_key"
  ON "funding_dept_school_assignments"("tenant_id", "org_unit_id", "member_id");

CREATE INDEX "idx_funding_dept_school_deputy"
  ON "funding_dept_school_assignments"("tenant_id", "is_deputy");
