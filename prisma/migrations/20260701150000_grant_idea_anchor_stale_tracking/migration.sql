ALTER TABLE "grant_section_drafts"
  ADD COLUMN "isStale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "staleReason" TEXT,
  ADD COLUMN "sourceIdeaAnchorHash" TEXT,
  ADD COLUMN "sourceContextFingerprint" TEXT;
