-- Where the application stands, recorded on the department's own contact log.
-- Nullable and free-form (like `kind`): most follow-ups are just notes, and a
-- new stage must not need a migration. Only 'SUBMITTED' carries a side effect,
-- applied in the API layer via the shared submission path.
ALTER TABLE "assignment_follow_ups" ADD COLUMN "stage" TEXT;

-- The accountability views ask "what is the latest stage on this assignment",
-- which is an index-only backwards scan with this.
CREATE INDEX IF NOT EXISTS "idx_assignment_follow_ups_stage"
  ON "assignment_follow_ups" ("assignment_id", "happened_at" DESC)
  WHERE "stage" IS NOT NULL;
