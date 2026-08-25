-- Patent Search (Funding Intelligence) shortlist: patents a grant writer saved
-- from PatentNest search results. The record is stored as a JSON snapshot taken
-- at save time so the shortlist stays readable even if the upstream record
-- changes. No foreign keys, matching idea_intelligence_runs: the shortlist is
-- user-owned and must outlive a deleted idea analysis.
CREATE TABLE IF NOT EXISTS "patent_shortlist_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "idea_run_id" TEXT,
  "publication_number" TEXT NOT NULL,
  "publication_number_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "record_json" JSONB NOT NULL,
  "note" TEXT,
  "source" TEXT NOT NULL DEFAULT 'patentnest',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patent_shortlist_items_pkey" PRIMARY KEY ("id")
);

-- One row per user per patent: saving twice updates the note instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS "patent_shortlist_items_user_number_key"
  ON "patent_shortlist_items" ("user_id", "publication_number_key");
CREATE INDEX IF NOT EXISTS "patent_shortlist_items_user_created_idx"
  ON "patent_shortlist_items" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "patent_shortlist_items_tenant_idx"
  ON "patent_shortlist_items" ("tenant_id");
CREATE INDEX IF NOT EXISTS "patent_shortlist_items_idea_run_idx"
  ON "patent_shortlist_items" ("idea_run_id");
