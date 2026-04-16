-- Add archetype detection persistence fields to drafting_sessions
ALTER TABLE "drafting_sessions"
  ADD COLUMN "archetypeId" VARCHAR(64),
  ADD COLUMN "archetypeConfidence" DOUBLE PRECISION,
  ADD COLUMN "contributionMode" VARCHAR(64),
  ADD COLUMN "evaluationScope" VARCHAR(64),
  ADD COLUMN "evidenceModality" VARCHAR(32),
  ADD COLUMN "archetypeRationale" TEXT,
  ADD COLUMN "archetypeComputedAt" TIMESTAMP(3),
  ADD COLUMN "archetypeVersion" INTEGER,
  ADD COLUMN "archetypeInputDigest" VARCHAR(128),
  ADD COLUMN "archetypeMissingSignals" JSONB,
  ADD COLUMN "archetypeContradictions" JSONB,
  ADD COLUMN "archetypeEvidenceStale" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "drafting_sessions_archetypeId_idx" ON "drafting_sessions"("archetypeId");
CREATE INDEX "drafting_sessions_archetypeEvidenceStale_idx" ON "drafting_sessions"("archetypeEvidenceStale");
