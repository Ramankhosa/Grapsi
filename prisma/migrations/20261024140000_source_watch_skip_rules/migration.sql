-- Admin "don't visit" marks on a page or a folder of a Source Watch site.
CREATE TABLE "monitor_skip_rules" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "match" TEXT NOT NULL DEFAULT 'PAGE',
    "reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_skip_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "monitor_skip_rules_site_id_dedup_key_match_key" ON "monitor_skip_rules"("site_id", "dedup_key", "match");
CREATE INDEX "monitor_skip_rules_site_id_idx" ON "monitor_skip_rules"("site_id");

ALTER TABLE "monitor_skip_rules" ADD CONSTRAINT "monitor_skip_rules_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Visits a mark paused, so removal or expiry restores exactly those.
ALTER TABLE "monitor_resources" ADD COLUMN "skip_paused_policy" TEXT;
-- Adaptive scheduling: unchanged revisits and quiet listing checks in a row.
ALTER TABLE "monitor_resources" ADD COLUMN "unchanged_revisits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "monitored_sources" ADD COLUMN "quiet_streak" INTEGER NOT NULL DEFAULT 0;
-- A delegated operator's catalogue-import request awaiting super-admin approval.
ALTER TABLE "monitor_sites" ADD COLUMN "pending_scope" JSONB;
