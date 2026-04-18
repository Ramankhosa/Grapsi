ALTER TABLE "grant_sessions"
  ADD COLUMN IF NOT EXISTS "draftingSessionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "grant_sessions_draftingSessionId_key"
  ON "grant_sessions"("draftingSessionId");

DO $$ BEGIN
  ALTER TABLE "grant_sessions"
    ADD CONSTRAINT "grant_sessions_draftingSessionId_fkey"
    FOREIGN KEY ("draftingSessionId") REFERENCES "drafting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
