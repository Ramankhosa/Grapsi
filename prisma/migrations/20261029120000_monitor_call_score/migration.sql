-- Call score v1 (29 Oct 2026): a deterministic call-likeness score per page, with
-- the signals behind it. Shadow mode: stored and shown, never used to close a page.
ALTER TABLE "monitor_resources" ADD COLUMN "call_score" INTEGER,
ADD COLUMN "call_band" TEXT,
ADD COLUMN "call_signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "call_scored_version_id" TEXT,
ADD COLUMN "call_scored_at" TIMESTAMP(3);

CREATE INDEX "monitor_resources_site_id_call_band_idx" ON "monitor_resources"("site_id", "call_band");
