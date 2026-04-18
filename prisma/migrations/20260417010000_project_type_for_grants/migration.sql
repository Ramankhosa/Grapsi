DO $$
BEGIN
  CREATE TYPE "ProjectType" AS ENUM ('PATENT', 'GRANT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "projectType" "ProjectType" NOT NULL DEFAULT 'PATENT';
