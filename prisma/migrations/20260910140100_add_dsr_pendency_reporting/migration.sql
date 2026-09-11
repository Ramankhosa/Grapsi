-- DSR pendency & accountability reporting.

-- When an officer closed an allocation out as never applied for. Separate from
-- updated_at, which moves on any edit, so a report can date the lost
-- opportunity. submitted_at and completed_at stay null on a lapse.
ALTER TABLE "call_assignments" ADD COLUMN "lapsed_at" TIMESTAMP(3);

-- Which rungs of the pendency ladder have fired for this (call, school):
-- OFFICER, HEAD, ADMIN. Claim-then-act, same as call_assignments.auto_nudge_stages.
ALTER TABLE "call_school_triage"
  ADD COLUMN "escalation_stages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Per-tenant funding-department thresholds and toggles. Null means "use the
-- defaults", which equal the constants these replaced.
ALTER TABLE "tenants" ADD COLUMN "dept_settings" JSONB;

-- One week's numbers per school, so the grid's snapshot gains a direction of
-- travel. Keyed on the school because coverage is reassigned; member_id records
-- who covered it that week and is null for a school nobody covered.
CREATE TABLE "funding_dept_weekly_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "member_id" TEXT,
    "org_unit_id" TEXT NOT NULL,
    "relevant_open" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "untouched_pending" INTEGER NOT NULL DEFAULT 0,
    "live" INTEGER NOT NULL DEFAULT 0,
    "gone_quiet" INTEGER NOT NULL DEFAULT 0,
    "overdue_unchased" INTEGER NOT NULL DEFAULT 0,
    "due_nudges" INTEGER NOT NULL DEFAULT 0,
    "submitted_in_week" INTEGER NOT NULL DEFAULT 0,
    "actions_in_week" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_dept_weekly_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "funding_dept_weekly_snapshots_week_unit_key"
  ON "funding_dept_weekly_snapshots"("tenant_id", "week_start", "org_unit_id");
CREATE INDEX "idx_funding_dept_snapshots_unit_week"
  ON "funding_dept_weekly_snapshots"("tenant_id", "org_unit_id", "week_start");
CREATE INDEX "idx_funding_dept_snapshots_member_week"
  ON "funding_dept_weekly_snapshots"("tenant_id", "member_id", "week_start");

ALTER TABLE "funding_dept_weekly_snapshots" ADD CONSTRAINT "funding_dept_weekly_snapshots_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_dept_weekly_snapshots" ADD CONSTRAINT "funding_dept_weekly_snapshots_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "funding_dept_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_dept_weekly_snapshots" ADD CONSTRAINT "funding_dept_weekly_snapshots_org_unit_id_fkey"
  FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
