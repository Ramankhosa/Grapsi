-- Add additive tenant-scoped role tags. Users can hold any combination.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CALL_ASSIGNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CALL_ADMIN';

-- Close the duplicate-school race: the existing composite unique on
-- (tenant_id, parent_id, name) doesn't cover NULL parent_id (schools).
-- Case-insensitive partial index enforces school-name uniqueness at the DB.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_org_units_school_name_key
  ON "tenant_org_units" ("tenant_id", lower("name"))
  WHERE "parent_id" IS NULL;
