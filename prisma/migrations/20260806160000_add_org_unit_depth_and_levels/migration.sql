-- Multi-level org hierarchy, phase 1: arbitrary depth + delegated headship.
--
-- The adjacency list already supported any depth; only application code capped
-- it at SCHOOL -> DEPARTMENT. A materialized path makes subtree membership a
-- single GIN-indexed array overlap instead of a recursive CTE on every
-- assignment, dashboard and matching request.

-- 1. Path / depth / level label -------------------------------------------
ALTER TABLE "tenant_org_units"
  ADD COLUMN IF NOT EXISTS "path" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "depth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "level_label" TEXT;

-- 2. Backfill existing trees ----------------------------------------------
-- Recursive rather than a two-statement shortcut: the shortcut would be exact
-- for today's two-level data, but this migration must also be correct if it is
-- ever re-run after deeper units exist.
WITH RECURSIVE tree AS (
  SELECT id, parent_id, 0 AS depth, ARRAY[id] AS path
    FROM tenant_org_units
   WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, t.depth + 1, t.path || c.id
    FROM tenant_org_units c
    JOIN tree t ON c.parent_id = t.id
)
UPDATE tenant_org_units u
   SET depth = tree.depth,
       path = tree.path,
       level_label = COALESCE(
         u.level_label,
         CASE WHEN tree.depth = 0 THEN 'School' ELSE 'Department' END
       )
  FROM tree
 WHERE tree.id = u.id;

-- Orphans (parent_id pointing at a missing row) are unreachable from the
-- recursion above and would keep an empty path, which reads as "in every
-- subtree query, nowhere". Promote them to roots so they stay visible.
UPDATE tenant_org_units
   SET depth = 0, path = ARRAY[id]
 WHERE path = '{}';

CREATE INDEX IF NOT EXISTS "idx_tenant_org_units_path"
  ON "tenant_org_units" USING GIN ("path");
CREATE INDEX IF NOT EXISTS "idx_tenant_org_units_tenant_depth"
  ON "tenant_org_units" ("tenant_id", "depth");

-- 3. Path maintenance ------------------------------------------------------
-- A trigger, not application code: ~150 scripts, the faculty importer and any
-- future seed all create units, and a trigger is the one thing they cannot
-- forget. src/lib/orgUnits/tree.ts#rebuildPaths repairs drift if it happens.
CREATE OR REPLACE FUNCTION tenant_org_units_set_path() RETURNS trigger AS $$
DECLARE
  parent_path  TEXT[];
  parent_depth INT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    NEW.path := ARRAY[NEW.id];
  ELSE
    SELECT path, depth INTO parent_path, parent_depth
      FROM tenant_org_units WHERE id = NEW.parent_id;

    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent org unit % not found', NEW.parent_id;
    END IF;
    IF NEW.id = ANY(parent_path) THEN
      RAISE EXCEPTION 'Org unit % cannot be moved under its own descendant', NEW.id;
    END IF;
    -- 7 levels is far past any real university and stops a runaway loop from
    -- growing paths without bound.
    IF parent_depth + 1 > 6 THEN
      RAISE EXCEPTION 'Org hierarchy is limited to 7 levels';
    END IF;

    NEW.depth := parent_depth + 1;
    NEW.path := parent_path || NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_org_units_set_path ON "tenant_org_units";
CREATE TRIGGER trg_tenant_org_units_set_path
  BEFORE INSERT OR UPDATE OF parent_id ON "tenant_org_units"
  FOR EACH ROW EXECUTE FUNCTION tenant_org_units_set_path();

-- Re-parenting rewrites every descendant's path in one statement. The SET list
-- deliberately omits parent_id so the UPDATE OF parent_id triggers do not
-- re-fire — no recursion, one pass.
CREATE OR REPLACE FUNCTION tenant_org_units_rewrite_descendants() RETURNS trigger AS $$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path THEN
    UPDATE tenant_org_units d
       SET path = NEW.path
                  || d.path[array_position(d.path, NEW.id) + 1 : array_length(d.path, 1)],
           depth = NEW.depth + (array_length(d.path, 1) - array_position(d.path, NEW.id))
     WHERE d.path @> ARRAY[NEW.id]
       AND d.id <> NEW.id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_org_units_rewrite_descendants ON "tenant_org_units";
CREATE TRIGGER trg_tenant_org_units_rewrite_descendants
  AFTER UPDATE OF parent_id ON "tenant_org_units"
  FOR EACH ROW EXECUTE FUNCTION tenant_org_units_rewrite_descendants();

-- 4. Per-tenant level names (presentational) -------------------------------
CREATE TABLE IF NOT EXISTS "tenant_org_levels" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "depth"         INTEGER NOT NULL,
  "singular_name" TEXT NOT NULL,
  "plural_name"   TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_org_levels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_org_levels_tenant_depth_key"
  ON "tenant_org_levels" ("tenant_id", "depth");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_org_levels_tenant_id_fkey') THEN
    ALTER TABLE "tenant_org_levels"
      ADD CONSTRAINT "tenant_org_levels_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed each tenant that already has a tree with its current vocabulary, so the
-- UI keeps saying "School" and "Department" exactly as it does today.
INSERT INTO "tenant_org_levels" ("id", "tenant_id", "depth", "singular_name", "plural_name", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."tenant_id", 0, 'School', 'Schools', NOW(), NOW()
  FROM (SELECT DISTINCT "tenant_id" FROM "tenant_org_units") t
    ON CONFLICT ("tenant_id", "depth") DO NOTHING;

INSERT INTO "tenant_org_levels" ("id", "tenant_id", "depth", "singular_name", "plural_name", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."tenant_id", 1, 'Department', 'Departments', NOW(), NOW()
  FROM (SELECT DISTINCT "tenant_id" FROM "tenant_org_units") t
    ON CONFLICT ("tenant_id", "depth") DO NOTHING;

-- 5. Delegated headship ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "OrgManagerScope" AS ENUM ('SUBTREE', 'UNIT_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "org_unit_managers" (
  "id"                   TEXT NOT NULL,
  "tenant_id"            TEXT NOT NULL,
  "org_unit_id"          TEXT NOT NULL,
  "user_id"              TEXT NOT NULL,
  "scope"                "OrgManagerScope" NOT NULL DEFAULT 'SUBTREE',
  "title"                TEXT,
  "can_assign"           BOOLEAN NOT NULL DEFAULT true,
  "can_view_reports"     BOOLEAN NOT NULL DEFAULT true,
  "can_manage_structure" BOOLEAN NOT NULL DEFAULT false,
  "can_manage_members"   BOOLEAN NOT NULL DEFAULT false,
  "is_active"            BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id"   TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_unit_managers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_unit_managers_unit_user_key"
  ON "org_unit_managers" ("org_unit_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_org_unit_managers_tenant_user"
  ON "org_unit_managers" ("tenant_id", "user_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_org_unit_managers_unit"
  ON "org_unit_managers" ("org_unit_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_unit_managers_tenant_id_fkey') THEN
    ALTER TABLE "org_unit_managers"
      ADD CONSTRAINT "org_unit_managers_tenant_id_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_unit_managers_org_unit_id_fkey') THEN
    ALTER TABLE "org_unit_managers"
      ADD CONSTRAINT "org_unit_managers_org_unit_id_fkey" FOREIGN KEY ("org_unit_id")
      REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_unit_managers_user_id_fkey') THEN
    ALTER TABLE "org_unit_managers"
      ADD CONSTRAINT "org_unit_managers_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_unit_managers_created_by_user_id_fkey') THEN
    ALTER TABLE "org_unit_managers"
      ADD CONSTRAINT "org_unit_managers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
      REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Assignment org snapshots ---------------------------------------------
-- Snapshots rather than live joins: the assigner is frequently an ADMIN with no
-- ResearcherProfile, so joining their profile would yield NULL and make "who
-- delegated this" ungroupable; and moving someone between departments must not
-- rewrite last year's report.
ALTER TABLE "call_assignments"
  ADD COLUMN IF NOT EXISTS "assignee_org_unit_id" TEXT,
  ADD COLUMN IF NOT EXISTS "assigner_org_unit_id" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_assignments_assignee_org_unit_id_fkey') THEN
    ALTER TABLE "call_assignments"
      ADD CONSTRAINT "call_assignments_assignee_org_unit_id_fkey" FOREIGN KEY ("assignee_org_unit_id")
      REFERENCES "tenant_org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_assignments_assigner_org_unit_id_fkey') THEN
    ALTER TABLE "call_assignments"
      ADD CONSTRAINT "call_assignments_assigner_org_unit_id_fkey" FOREIGN KEY ("assigner_org_unit_id")
      REFERENCES "tenant_org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Best-effort backfill from CURRENT placement. Anyone who has since changed
-- department gets today's unit, which is the closest available approximation;
-- rows going forward are true snapshots written at assignment time.
UPDATE call_assignments ca
   SET assignee_org_unit_id = rp.org_unit_id
  FROM researcher_profiles rp
 WHERE rp.user_id = ca.assignee_user_id
   AND ca.assignee_org_unit_id IS NULL;

UPDATE call_assignments ca
   SET assigner_org_unit_id = rp.org_unit_id
  FROM researcher_profiles rp
 WHERE rp.user_id = ca.assigned_by_user_id
   AND ca.assigner_org_unit_id IS NULL;

CREATE INDEX IF NOT EXISTS "idx_call_assignments_assignee_unit"
  ON "call_assignments" ("tenant_id", "assignee_org_unit_id");
CREATE INDEX IF NOT EXISTS "idx_call_assignments_assigner_unit"
  ON "call_assignments" ("tenant_id", "assigner_org_unit_id");

-- 7. Opt-in tenant lockdown ------------------------------------------------
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "org_scope_enforced" BOOLEAN NOT NULL DEFAULT false;
