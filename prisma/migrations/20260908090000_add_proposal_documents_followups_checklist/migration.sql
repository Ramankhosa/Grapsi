-- The rest of the office's job, after the proposal is written.
--
-- Three things the desk did on paper and had nowhere to put:
--   * the endorsement letter it ISSUES (the applicant cannot submit without it);
--   * the follow-up call it makes to find out what the agency has done;
--   * the bundle of attachments it checks before clearing anything.
--
-- Plus one correction: post-award obligations (instalments, utilisation
-- certificates, statements of expenditure) hung off an assignment, so a
-- sanctioned grant that arrived as an agency letter — with no call and no
-- assignment behind it — had nowhere to record them. That is a hole the ad hoc
-- proposal path opened, and this closes it.

-- ---------------------------------------------------------------------------
-- The funded project's own dates
-- ---------------------------------------------------------------------------
ALTER TABLE "grant_proposals" ADD COLUMN IF NOT EXISTS "project_start_at" TIMESTAMP(3);
-- A date, not a duration off the start: an agency extension moves the end
-- without changing when the work began.
ALTER TABLE "grant_proposals" ADD COLUMN IF NOT EXISTS "project_end_at" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- grant_proposal_documents — what the institution issues
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ENDORSEMENT',
    "reference_no" TEXT,
    "issued_on" TIMESTAMP(3),
    "signed_by" TEXT,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "byte_size" INTEGER NOT NULL DEFAULT 0,
    "storage_path" TEXT NOT NULL,
    "note" TEXT,
    "visible_to_faculty" BOOLEAN NOT NULL DEFAULT true,
    "issued_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposal_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposal_documents_kind_check" CHECK ("kind" IN (
        'ENDORSEMENT','FORWARDING','NOC','SANCTION_ORDER','AGREEMENT','CERTIFICATE','OTHER'
    ))
);

CREATE INDEX "idx_grant_proposal_documents_proposal" ON "grant_proposal_documents"("proposal_id", "created_at");
CREATE INDEX "idx_grant_proposal_documents_kind" ON "grant_proposal_documents"("tenant_id", "kind");

-- ---------------------------------------------------------------------------
-- grant_proposal_follow_ups — the contact log, with its ticklers
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_follow_ups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CALL',
    "note" TEXT NOT NULL,
    "happened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_status" TEXT,
    "remind_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "visible_to_faculty" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposal_follow_ups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposal_follow_ups_kind_check" CHECK ("kind" IN (
        'CALL','EMAIL','MEETING','PORTAL','NOTE'
    ))
);

CREATE INDEX "idx_grant_proposal_follow_ups_proposal" ON "grant_proposal_follow_ups"("proposal_id", "happened_at");
-- The sweep's index: only rows that are actually waiting to fire.
CREATE INDEX "idx_grant_proposal_follow_ups_remind" ON "grant_proposal_follow_ups"("remind_at")
    WHERE "remind_at" IS NOT NULL AND "reminder_sent_at" IS NULL;

-- ---------------------------------------------------------------------------
-- grant_proposal_checklist_items — what must be attached before clearing
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_checklist_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "document_id" TEXT,
    "visible_to_faculty" BOOLEAN NOT NULL DEFAULT true,
    "completed_by_user_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposal_checklist_items_pkey" PRIMARY KEY ("id"),
    -- WAIVED and NOT_APPLICABLE are deliberately distinct: one is a decision the
    -- office made and should be able to explain, the other never applied.
    CONSTRAINT "grant_proposal_checklist_status_check" CHECK ("status" IN (
        'PENDING','DONE','WAIVED','NOT_APPLICABLE'
    ))
);

CREATE INDEX "idx_grant_proposal_checklist_proposal" ON "grant_proposal_checklist_items"("proposal_id", "sort_order");

-- ---------------------------------------------------------------------------
-- assignment_milestones — let a proposal own one
--
-- Same shape as the change assignment_follow_ups took when call-level notes
-- arrived: the owning column becomes nullable, a sibling is added, and a CHECK
-- keeps exactly one of them set. Existing rows all have an assignment, so the
-- backfill is a no-op and the CHECK is satisfied from the moment it is added.
-- ---------------------------------------------------------------------------
ALTER TABLE "assignment_milestones" ALTER COLUMN "assignment_id" DROP NOT NULL;
ALTER TABLE "assignment_milestones" ADD COLUMN IF NOT EXISTS "proposal_id" TEXT;

ALTER TABLE "assignment_milestones" ADD CONSTRAINT "assignment_milestones_owner_check"
    CHECK (
        ("assignment_id" IS NOT NULL AND "proposal_id" IS NULL)
        OR ("assignment_id" IS NULL AND "proposal_id" IS NOT NULL)
    );

CREATE INDEX "idx_assignment_milestones_proposal" ON "assignment_milestones"("proposal_id", "due_at");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "grant_proposal_documents" ADD CONSTRAINT "grant_proposal_documents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_documents" ADD CONSTRAINT "grant_proposal_documents_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_documents" ADD CONSTRAINT "grant_proposal_documents_issued_by_user_id_fkey"
    FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_follow_ups" ADD CONSTRAINT "grant_proposal_follow_ups_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_follow_ups" ADD CONSTRAINT "grant_proposal_follow_ups_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_follow_ups" ADD CONSTRAINT "grant_proposal_follow_ups_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_checklist_items" ADD CONSTRAINT "grant_proposal_checklist_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_checklist_items" ADD CONSTRAINT "grant_proposal_checklist_items_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, not Cascade: deleting the endorsement letter must not delete the
-- checklist line that says an endorsement letter is required.
ALTER TABLE "grant_proposal_checklist_items" ADD CONSTRAINT "grant_proposal_checklist_items_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "grant_proposal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_checklist_items" ADD CONSTRAINT "grant_proposal_checklist_items_completed_by_user_id_fkey"
    FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "assignment_milestones" ADD CONSTRAINT "assignment_milestones_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
