CREATE TABLE "monitor_coverage_gaps" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OPEN',
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitor_coverage_gaps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "monitor_coverage_gaps_site_id_url_kind_key" ON "monitor_coverage_gaps"("site_id", "url", "kind");
CREATE INDEX "monitor_coverage_gaps_state_last_seen_at_idx" ON "monitor_coverage_gaps"("state", "last_seen_at");
