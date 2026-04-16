-- AlterTable: add libraryReferenceId to citations for direct document access
ALTER TABLE "citations" ADD COLUMN IF NOT EXISTS "libraryReferenceId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "citations_libraryReferenceId_idx" ON "citations"("libraryReferenceId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'citations_libraryReferenceId_fkey'
  ) THEN
    ALTER TABLE "citations" ADD CONSTRAINT "citations_libraryReferenceId_fkey"
      FOREIGN KEY ("libraryReferenceId") REFERENCES "reference_library"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: link existing citations to their library references by DOI match
UPDATE "citations" c
SET "libraryReferenceId" = (
  SELECT rl.id
  FROM "reference_library" rl
  JOIN "drafting_sessions" ds ON ds.id = c."sessionId"
  WHERE rl."user_id" = ds."userId"
    AND rl."isActive" = true
    AND rl.doi IS NOT NULL
    AND c.doi IS NOT NULL
    AND LOWER(TRIM(rl.doi)) = LOWER(TRIM(c.doi))
  ORDER BY rl."updatedAt" DESC
  LIMIT 1
)
WHERE c."libraryReferenceId" IS NULL
  AND c.doi IS NOT NULL;

-- Backfill: link remaining citations by title+year match
UPDATE "citations" c
SET "libraryReferenceId" = (
  SELECT rl.id
  FROM "reference_library" rl
  JOIN "drafting_sessions" ds ON ds.id = c."sessionId"
  WHERE rl."user_id" = ds."userId"
    AND rl."isActive" = true
    AND LOWER(TRIM(rl.title)) = LOWER(TRIM(c.title))
    AND (rl.year = c.year OR (rl.year IS NULL AND c.year IS NULL))
  ORDER BY rl."updatedAt" DESC
  LIMIT 1
)
WHERE c."libraryReferenceId" IS NULL
  AND c.title IS NOT NULL
  AND TRIM(c.title) <> '';
