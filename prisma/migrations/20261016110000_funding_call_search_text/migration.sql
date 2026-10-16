-- Funding-call full-text search: more of an imported call is searchable, and
-- the taxonomy branch of the finder's text match can use an index.
--
-- 1. update_funding_call_ts_document() also indexes title_native, summary,
--    source_disciplines, challenge_tags, programme_framework and
--    target_groups, for IMPORTED rows only (import_run_id IS NOT NULL).
--    Legacy calls keep exactly the document they have today, including after
--    a curator edit: summary is an older column curated calls already fill,
--    and indexing it would change their finder results outside the Phase E
--    parity window. Phase E lifts the gate. No row is recomputed here (no
--    UPDATE in a migration): scripts/refresh-catalog-search-text.ts recomputes
--    imported rows, and any later write recomputes a row through the trigger
--    as before.
-- 2. A GIN expression index on the taxonomy text of
--    funding_call_research_area_taxonomies. An expression index rather than a
--    generated column: adding a STORED column would rewrite every mapping row.
--    The expression must stay identical to taxonomyTextVectorSql() in
--    recommendationSearchService.ts, or the index is not used. It yields the
--    same lexemes as the CONCAT_WS form the finder used (to_tsvector ignores
--    the extra spaces); CONCAT_WS itself cannot be indexed (not immutable).

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION update_funding_call_ts_document()
RETURNS TRIGGER AS $$
BEGIN
  NEW."ts_document" :=
    setweight(to_tsvector('english', coalesce(NEW."scheme_title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."disciplines", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."funding_kinds", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."institution_types", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."career_stages", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."eligible_countries", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."eligible_regions", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."host_countries", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."sponsor_type", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."funder_country", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."eligibility_text", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."expected_deliverables_text", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."contact_info", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."agency_name", '')), 'D');
  IF NEW."import_run_id" IS NOT NULL THEN
    NEW."ts_document" := NEW."ts_document" ||
      -- Native-language titles use 'english' like every other field: the
      -- finder's query is english-stemmed, and a 'simple' lexeme
      -- ("adipositas") never equals the stemmed query term ("adiposita").
      setweight(to_tsvector('english', coalesce(NEW."title_native", '')), 'B') ||
      setweight(to_tsvector('english', coalesce(array_to_string(NEW."source_disciplines", ' '), '')), 'B') ||
      -- The synopsis overlaps the description, so it weighs less.
      setweight(to_tsvector('english', coalesce(NEW."summary", '')), 'C') ||
      setweight(to_tsvector('english', coalesce(array_to_string(NEW."challenge_tags", ' '), '')), 'C') ||
      setweight(to_tsvector('english', coalesce(NEW."programme_framework", '')), 'C') ||
      setweight(to_tsvector('english', coalesce(array_to_string(NEW."target_groups", ' '), '')), 'C');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS "funding_call_research_area_taxonomies_text_idx"
  ON "funding_call_research_area_taxonomies" USING GIN (
    to_tsvector(
      'english',
      coalesce("taxonomy_level1_code", '') || ' ' || coalesce("taxonomy_level1_name", '') || ' ' ||
      coalesce("taxonomy_level2_code", '') || ' ' || coalesce("taxonomy_level2_name", '')
    )
  );
