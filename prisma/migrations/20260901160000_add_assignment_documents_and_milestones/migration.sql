-- Evidence on an assignment, and the obligations that follow an award.
--
-- Until now an assignment held a message, a deadline, a submission link and one
-- outcome. The concept note and the sanction order lived in email, and
-- "awarded" was where the system stopped knowing anything.

CREATE TABLE "assignment_documents" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'OTHER',
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "byte_size" INTEGER NOT NULL DEFAULT 0,
  "storage_path" TEXT NOT NULL,
  "note" TEXT,
  "visible_to_assignee" BOOLEAN NOT NULL DEFAULT true,
  "uploaded_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assignment_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_assignment_documents_assignment"
  ON "assignment_documents"("assignment_id", "created_at");
CREATE INDEX "idx_assignment_documents_tenant" ON "assignment_documents"("tenant_id");

ALTER TABLE "assignment_documents"
  ADD CONSTRAINT "assignment_documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignment_documents"
  ADD CONSTRAINT "assignment_documents_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "call_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignment_documents"
  ADD CONSTRAINT "assignment_documents_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "assignment_milestones" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'OTHER',
  "title" TEXT NOT NULL,
  "due_at" TIMESTAMP(3),
  "amount" DOUBLE PRECISION,
  "currency" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMP(3),
  "note" TEXT,
  "auto_nudge_stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "assignment_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_assignment_milestones_assignment"
  ON "assignment_milestones"("assignment_id", "due_at");
CREATE INDEX "idx_assignment_milestones_due"
  ON "assignment_milestones"("tenant_id", "status", "due_at");

ALTER TABLE "assignment_milestones"
  ADD CONSTRAINT "assignment_milestones_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignment_milestones"
  ADD CONSTRAINT "assignment_milestones_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "call_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignment_milestones"
  ADD CONSTRAINT "assignment_milestones_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
