-- CreateEnum
CREATE TYPE "OrgUnitKind" AS ENUM ('SCHOOL', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "CallAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "researcher_profiles" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "org_unit_id" TEXT,
ADD COLUMN     "school" TEXT;

-- CreateTable
CREATE TABLE "tenant_org_units" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "kind" "OrgUnitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sort_order" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "assignee_user_id" TEXT NOT NULL,
    "assigned_by_user_id" TEXT NOT NULL,
    "message" TEXT,
    "deadline_at" TIMESTAMP(3),
    "status" "CallAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "match_score" DOUBLE PRECISION,
    "match_tier" TEXT,
    "match_basis" TEXT,
    "submission_reference" TEXT,
    "submission_url" TEXT,
    "submission_notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_import_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "filename" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "report_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faculty_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tenant_org_units_tenant_kind" ON "tenant_org_units"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "idx_tenant_org_units_parent" ON "tenant_org_units"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_org_units_tenant_parent_name_key" ON "tenant_org_units"("tenant_id", "parent_id", "name");

-- CreateIndex
CREATE INDEX "idx_call_assignments_tenant_assignee" ON "call_assignments"("tenant_id", "assignee_user_id");

-- CreateIndex
CREATE INDEX "idx_call_assignments_tenant_status" ON "call_assignments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_call_assignments_assigned_by" ON "call_assignments"("assigned_by_user_id");

-- CreateIndex
CREATE INDEX "idx_call_assignments_deadline" ON "call_assignments"("deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "call_assignments_call_assignee_key" ON "call_assignments"("funding_call_id", "assignee_user_id");

-- CreateIndex
CREATE INDEX "idx_faculty_import_jobs_tenant_created" ON "faculty_import_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_researcher_profiles_org_unit" ON "researcher_profiles"("org_unit_id");

-- AddForeignKey
ALTER TABLE "researcher_profiles" ADD CONSTRAINT "researcher_profiles_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_org_units" ADD CONSTRAINT "tenant_org_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_org_units" ADD CONSTRAINT "tenant_org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_assignments" ADD CONSTRAINT "call_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_assignments" ADD CONSTRAINT "call_assignments_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_assignments" ADD CONSTRAINT "call_assignments_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_assignments" ADD CONSTRAINT "call_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_import_jobs" ADD CONSTRAINT "faculty_import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_import_jobs" ADD CONSTRAINT "faculty_import_jobs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
