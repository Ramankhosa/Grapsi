-- Grant proposals: the tenant's own applications end to end.
--
-- The department could already record that a call was delegated and that a
-- submission happened. Between those two facts sat the whole of its actual
-- work -- the draft, the internal review, the revision, the budget, the
-- co-investigators, the agency's answer -- and none of it had a home. This is
-- that home.
--
-- Conventions followed from the rest of the funding-department module:
--   * statuses are TEXT with a CHECK, not Postgres enums, so a new state needs
--     no migration and no positional ALTER TYPE;
--   * money is DOUBLE PRECISION like call_assignments.award_amount;
--   * deletes of a call or an assignment SET NULL rather than cascading -- the
--     record that an application existed must outlive its catalog row.

-- Per-tenant proposal-desk policy (cut-off offset, who may record a submission,
-- the institution's budget heads). Null means "use the defaults".
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "proposal_settings" JSONB;

-- ---------------------------------------------------------------------------
-- grant_proposals
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "funding_call_id" TEXT,
    "assignment_id" TEXT,
    "grant_session_id" TEXT,
    "reviewer_call_id" TEXT,
    "pi_user_id" TEXT NOT NULL,
    "org_unit_id" TEXT NOT NULL,
    "pi_org_unit_id" TEXT,
    "title" TEXT NOT NULL,
    "agency_name" TEXT NOT NULL,
    "scheme_title" TEXT,
    "agency_deadline_at" TIMESTAMP(3),
    "review_cutoff_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_no" INTEGER NOT NULL DEFAULT 0,
    "nudge_stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_months" INTEGER,
    "requested_amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sanctioned_amount" DOUBLE PRECISION,
    "sanction_reference" TEXT,
    "sanction_date" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "submission_reference" TEXT,
    "submission_url" TEXT,
    "agency_status_note" TEXT,
    "agency_status_updated_at" TIMESTAMP(3),
    "cleared_by_user_id" TEXT,
    "cleared_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposals_status_check" CHECK ("status" IN (
        'DRAFT','IN_REVIEW','CLEARED','SUBMITTED','UNDER_AGENCY_REVIEW',
        'REVISION_REQUESTED','SANCTIONED','REJECTED','WITHDRAWN','CLOSED'
    ))
);

CREATE UNIQUE INDEX "grant_proposals_assignment_id_key" ON "grant_proposals"("assignment_id");
CREATE UNIQUE INDEX "grant_proposals_reviewer_call_id_key" ON "grant_proposals"("reviewer_call_id");

-- One live application per (call, PI). Withdrawn ones are excluded so a
-- researcher who pulled out can start again without an admin clearing the row.
CREATE UNIQUE INDEX "grant_proposals_call_pi_key" ON "grant_proposals"("tenant_id", "funding_call_id", "pi_user_id")
    WHERE "funding_call_id" IS NOT NULL AND "status" <> 'WITHDRAWN';

CREATE INDEX "idx_grant_proposals_tenant_status" ON "grant_proposals"("tenant_id", "status");
CREATE INDEX "idx_grant_proposals_unit" ON "grant_proposals"("tenant_id", "org_unit_id", "status");
CREATE INDEX "idx_grant_proposals_pi" ON "grant_proposals"("pi_user_id");
CREATE INDEX "idx_grant_proposals_call" ON "grant_proposals"("funding_call_id");
-- Partial indexes for the two sweeps, so neither scans the whole table.
CREATE INDEX "idx_grant_proposals_cutoff" ON "grant_proposals"("review_cutoff_at") WHERE "status" = 'IN_REVIEW';
CREATE INDEX "idx_grant_proposals_agency_stale" ON "grant_proposals"("agency_status_updated_at")
    WHERE "status" IN ('SUBMITTED','UNDER_AGENCY_REVIEW');

-- ---------------------------------------------------------------------------
-- grant_proposal_versions
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "byte_size" INTEGER NOT NULL DEFAULT 0,
    "storage_path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT,
    "override_reason" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'NONE',
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grant_proposal_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposal_versions_review_status_check" CHECK ("review_status" IN (
        'NONE','QUEUED','RUNNING','REVIEWED','FAILED','SHARED'
    ))
);

-- The version number is taken under an advisory lock; this is the backstop that
-- makes two concurrent uploads impossible rather than merely unlikely.
CREATE UNIQUE INDEX "grant_proposal_versions_no_key" ON "grant_proposal_versions"("proposal_id", "version_no");
-- Re-uploading identical bytes is a mistake to report, not a draft to bill for.
CREATE UNIQUE INDEX "grant_proposal_versions_sha_key" ON "grant_proposal_versions"("proposal_id", "sha256");
CREATE INDEX "idx_grant_proposal_versions_proposal" ON "grant_proposal_versions"("proposal_id", "created_at");

-- ---------------------------------------------------------------------------
-- grant_proposal_reviews
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "reviewer_call_id" TEXT NOT NULL,
    "run_by_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "import_summary" JSONB,
    "started_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "error_code" TEXT,
    "skip_import" BOOLEAN NOT NULL DEFAULT false,
    "overall_score" DOUBLE PRECISION,
    "recommendation" TEXT,
    "report_snapshot" JSONB,
    "docx_storage_path" TEXT,
    "shared_at" TIMESTAMP(3),
    "shared_by_user_id" TEXT,
    "officer_note" TEXT,
    "internal_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposal_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposal_reviews_status_check" CHECK ("status" IN (
        'QUEUED','IMPORTING','REVIEWING','REPORTING','DONE','FAILED','CANCELLED'
    ))
);

CREATE UNIQUE INDEX "grant_proposal_reviews_version_id_key" ON "grant_proposal_reviews"("version_id");
CREATE INDEX "idx_grant_proposal_reviews_proposal" ON "grant_proposal_reviews"("proposal_id", "created_at");
-- The resume sweep's index: live runs only, ordered by how long since they last
-- said anything.
CREATE INDEX "idx_grant_proposal_reviews_sweep" ON "grant_proposal_reviews"("status", "heartbeat_at")
    WHERE "status" IN ('QUEUED','IMPORTING','REVIEWING','REPORTING');

-- ---------------------------------------------------------------------------
-- grant_proposal_team_members
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_team_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "affiliation" TEXT,
    "org_unit_id" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CO_PI',
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposal_team_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposal_team_role_check" CHECK ("role" IN (
        'PI','CO_PI','CO_I','COLLABORATOR','MENTOR'
    ))
);

-- A person appears once on an application. External members carry no user id,
-- so the constraint is partial.
CREATE UNIQUE INDEX "grant_proposal_team_user_key" ON "grant_proposal_team_members"("proposal_id", "user_id")
    WHERE "user_id" IS NOT NULL;
CREATE INDEX "idx_grant_proposal_team_proposal" ON "grant_proposal_team_members"("proposal_id", "sort_order");
CREATE INDEX "idx_grant_proposal_team_user" ON "grant_proposal_team_members"("user_id");

-- ---------------------------------------------------------------------------
-- grant_proposal_budget_lines
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_budget_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "head" TEXT NOT NULL,
    "year_no" INTEGER NOT NULL DEFAULT 1,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_proposal_budget_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grant_proposal_budget_head_check" CHECK ("head" IN (
        'MANPOWER','EQUIPMENT','CONSUMABLES','TRAVEL','CONTINGENCY','OVERHEADS','OTHER'
    )),
    CONSTRAINT "grant_proposal_budget_year_check" CHECK ("year_no" >= 1 AND "year_no" <= 10)
);

CREATE UNIQUE INDEX "grant_proposal_budget_key" ON "grant_proposal_budget_lines"("proposal_id", "head", "year_no");

-- ---------------------------------------------------------------------------
-- grant_proposal_events
-- ---------------------------------------------------------------------------
CREATE TABLE "grant_proposal_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "kind" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "payload" JSONB,
    "visible_to_faculty" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grant_proposal_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_grant_proposal_events_proposal" ON "grant_proposal_events"("proposal_id", "created_at");
CREATE INDEX "idx_grant_proposal_events_tenant" ON "grant_proposal_events"("tenant_id", "created_at");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_funding_call_id_fkey"
    FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "call_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_grant_session_id_fkey"
    FOREIGN KEY ("grant_session_id") REFERENCES "grant_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_reviewer_call_id_fkey"
    FOREIGN KEY ("reviewer_call_id") REFERENCES "reviewer_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_pi_user_id_fkey"
    FOREIGN KEY ("pi_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_cleared_by_user_id_fkey"
    FOREIGN KEY ("cleared_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_pi_org_unit_id_fkey"
    FOREIGN KEY ("pi_org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_versions" ADD CONSTRAINT "grant_proposal_versions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_versions" ADD CONSTRAINT "grant_proposal_versions_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_versions" ADD CONSTRAINT "grant_proposal_versions_uploaded_by_user_id_fkey"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_reviews" ADD CONSTRAINT "grant_proposal_reviews_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_reviews" ADD CONSTRAINT "grant_proposal_reviews_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_reviews" ADD CONSTRAINT "grant_proposal_reviews_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "grant_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_reviews" ADD CONSTRAINT "grant_proposal_reviews_run_by_user_id_fkey"
    FOREIGN KEY ("run_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_reviews" ADD CONSTRAINT "grant_proposal_reviews_shared_by_user_id_fkey"
    FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_team_members" ADD CONSTRAINT "grant_proposal_team_members_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_team_members" ADD CONSTRAINT "grant_proposal_team_members_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_team_members" ADD CONSTRAINT "grant_proposal_team_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_team_members" ADD CONSTRAINT "grant_proposal_team_members_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_budget_lines" ADD CONSTRAINT "grant_proposal_budget_lines_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_budget_lines" ADD CONSTRAINT "grant_proposal_budget_lines_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grant_proposal_events" ADD CONSTRAINT "grant_proposal_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_events" ADD CONSTRAINT "grant_proposal_events_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "grant_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grant_proposal_events" ADD CONSTRAINT "grant_proposal_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
