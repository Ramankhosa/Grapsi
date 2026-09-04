-- Attribution for manual classification overrides.
--
-- A row in this table is either the classifier's opinion or a person's
-- correction of it, and until now the two were only distinguishable by
-- `source`. Recording who made a correction is the minimum for a row that
-- deliberately overrides automation and then survives every re-classification.
--
-- Nullable and SetNull: machine-written rows have no author, and deleting a
-- user must not delete their corrections.

ALTER TABLE "funding_call_research_area_taxonomies" ADD COLUMN "created_by_user_id" TEXT;

ALTER TABLE "funding_call_research_area_taxonomies"
  ADD CONSTRAINT "funding_call_research_area_taxonomies_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
