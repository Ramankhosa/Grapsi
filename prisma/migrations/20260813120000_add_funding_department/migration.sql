-- Funding Department: the tenant's central sponsored-research office.
--
-- Enum values are inserted POSITIONALLY, not appended: Postgres orders enums by
-- declaration order and GET /api/assignments sorts by status, so appending would
-- put ACCEPTED after CANCELLED in every list. Adding a value and using it in the
-- same transaction is illegal in Postgres, so this migration only adds values and
-- nullable columns — no data writes reference the new statuses.
ALTER TYPE "CallAssignmentStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED' AFTER 'ASSIGNED';
ALTER TYPE "CallAssignmentStatus" ADD VALUE IF NOT EXISTS 'DECLINED' AFTER 'CANCELLED';

-- The assignee's answer to the request.
ALTER TABLE "call_assignments"
  ADD COLUMN IF NOT EXISTS "declined_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "responded_at" TIMESTAMP(3);

-- Department membership.
CREATE TABLE IF NOT EXISTS "funding_dept_members" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "is_head" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "added_by_user_id" TEXT,
  "last_digest_sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "funding_dept_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "funding_dept_members_tenant_user_key"
  ON "funding_dept_members" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_funding_dept_members_tenant_active"
  ON "funding_dept_members" ("tenant_id", "is_active");

-- One active head per tenant. Partial unique index, same pattern as
-- tenant_org_units_school_name_key: deactivated ex-heads keep their flag for
-- history without blocking the slot.
CREATE UNIQUE INDEX IF NOT EXISTS "funding_dept_one_head_key"
  ON "funding_dept_members" ("tenant_id")
  WHERE "is_head" AND "is_active";

-- Which schools each member looks after.
CREATE TABLE IF NOT EXISTS "funding_dept_school_assignments" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "org_unit_id" TEXT NOT NULL,
  "assigned_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_dept_school_assignments_pkey" PRIMARY KEY ("id")
);

-- Exactly one member covers a school at a time. This IS the accountability
-- rule; the API turns the resulting P2002 into a readable 409.
CREATE UNIQUE INDEX IF NOT EXISTS "funding_dept_school_one_member_key"
  ON "funding_dept_school_assignments" ("tenant_id", "org_unit_id");
CREATE INDEX IF NOT EXISTS "idx_funding_dept_school_member"
  ON "funding_dept_school_assignments" ("member_id");

-- Internal contact log + scheduled nudges.
CREATE TABLE IF NOT EXISTS "assignment_follow_ups" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'NOTE',
  "note" TEXT NOT NULL,
  "happened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remind_at" TIMESTAMP(3),
  "remind_faculty" BOOLEAN NOT NULL DEFAULT false,
  "reminder_sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assignment_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_assignment_follow_ups_assignment"
  ON "assignment_follow_ups" ("assignment_id", "happened_at");
CREATE INDEX IF NOT EXISTS "idx_assignment_follow_ups_author"
  ON "assignment_follow_ups" ("tenant_id", "created_by_user_id");

-- The hourly sweep only ever looks at unsent, scheduled reminders.
CREATE INDEX IF NOT EXISTS "idx_assignment_follow_ups_due"
  ON "assignment_follow_ups" ("remind_at")
  WHERE "reminder_sent_at" IS NULL AND "remind_at" IS NOT NULL;

-- Foreign keys.
ALTER TABLE "funding_dept_members"
  ADD CONSTRAINT "funding_dept_members_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "funding_dept_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "funding_dept_members_added_by_user_id_fkey"
    FOREIGN KEY ("added_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "funding_dept_school_assignments"
  ADD CONSTRAINT "funding_dept_school_assignments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "funding_dept_school_assignments_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "funding_dept_members" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "funding_dept_school_assignments_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "funding_dept_school_assignments_assigned_by_user_id_fkey"
    FOREIGN KEY ("assigned_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "assignment_follow_ups"
  ADD CONSTRAINT "assignment_follow_ups_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "assignment_follow_ups_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "call_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "assignment_follow_ups_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
