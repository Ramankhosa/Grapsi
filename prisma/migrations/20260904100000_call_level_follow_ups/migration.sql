-- Call-level follow-ups.
--
-- A follow-up could only hang off an assignment, so the earliest chasing —
-- "rang the HoD about this call, nobody free yet" — had nowhere to be
-- recorded. assignment_id becomes optional; a row is either assignment-level
-- (assignment_id set) or call-level (funding_call_id + org_unit_id set), and the
-- CHECK below is the backstop for that shape. Callers validate it first: Prisma
-- has no error code for check_violation, so a bad row would surface as a 500.
--
-- Going forward funding_call_id / org_unit_id are stamped on assignment-level
-- rows as well (and backfilled here), so a call's whole history in one school
-- is a single indexed scan.

-- AlterTable
ALTER TABLE "assignment_follow_ups" ALTER COLUMN "assignment_id" DROP NOT NULL;
ALTER TABLE "assignment_follow_ups" ADD COLUMN "funding_call_id" TEXT;
ALTER TABLE "assignment_follow_ups" ADD COLUMN "org_unit_id" TEXT;

-- AddForeignKey (Cascade, not SetNull — a SetNull on a call-level row would
-- violate the shape CHECK and make deleting a school throw after its own
-- guards had passed)
ALTER TABLE "assignment_follow_ups" ADD CONSTRAINT "assignment_follow_ups_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_follow_ups" ADD CONSTRAINT "assignment_follow_ups_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing row is assignment-level; copy the call and the
-- assignee's unit snapshot across so the new index covers old history too.
UPDATE "assignment_follow_ups" f
   SET "funding_call_id" = ca."funding_call_id",
       "org_unit_id"     = ca."assignee_org_unit_id"
  FROM "call_assignments" ca
 WHERE ca."id" = f."assignment_id"
   AND f."funding_call_id" IS NULL;

-- Shape: assignment-level, or call-level with both keys.
ALTER TABLE "assignment_follow_ups" ADD CONSTRAINT "assignment_follow_ups_shape_check"
  CHECK ("assignment_id" IS NOT NULL OR ("funding_call_id" IS NOT NULL AND "org_unit_id" IS NOT NULL));

-- CreateIndex
CREATE INDEX "idx_assignment_follow_ups_call_unit" ON "assignment_follow_ups"("tenant_id", "funding_call_id", "org_unit_id", "happened_at");
