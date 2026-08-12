-- Optional org-issued staff/employee number on the researcher profile.
-- Nullable by design: plenty of tenants run their roster on email alone, and
-- an org that adopts IDs later can backfill without a second migration.
ALTER TABLE "researcher_profiles" ADD COLUMN IF NOT EXISTS "employee_id" TEXT;

-- Lookup index only. Per-tenant uniqueness cannot be a DB constraint here:
-- researcher_profiles has no tenant_id (tenancy lives on users), and Postgres
-- cannot index across tables. The faculty importer enforces it by joining
-- through users before it writes.
CREATE INDEX IF NOT EXISTS "idx_researcher_profiles_employee_id"
  ON "researcher_profiles" ("employee_id");
