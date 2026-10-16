-- Funding-call vector search: HNSW replaces the two IVFFlat indexes.
--
-- Both IVFFlat indexes were created by the migrations that ADDED their
-- columns (20260416020000, 20260702100000), so they were trained on zero
-- rows: their 100 centroids say nothing about the data. On the dev catalogue
-- (8,356 vectors) a broad query the planner sends to the old index returned
-- 32% of the true top 20; HNSW returned 100% in ~1.5 ms
-- (docs/vector-index-benchmark.md). HNSW needs no training data, so it stays
-- correct as calls are added.
--
-- The old indexes have to go: with both present the planner keeps choosing
-- the IVFFlat one. Dropping an index removes no data; re-running the CREATE
-- INDEX statements from the two migrations above restores them.
--
-- Needs pgvector >= 0.5 (HNSW). On an older pgvector nothing changes and a
-- NOTICE says so. Query-time settings (ef_search, and iterative scan on
-- pgvector >= 0.8) are applied per query by src/lib/vectorSearch.ts.
--
-- CREATE INDEX blocks writes to funding_calls while it builds (~3 s per index
-- at 10k calls on dev): apply outside import or intake runs.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  pgvector_version text := (SELECT extversion FROM pg_extension WHERE extname = 'vector');
BEGIN
  IF pgvector_version IS NULL OR string_to_array(pgvector_version, '.')::int[] < ARRAY[0, 5] THEN
    RAISE NOTICE 'pgvector % has no HNSW: funding_calls vector indexes left unchanged', pgvector_version;
    RETURN;
  END IF;

  CREATE INDEX IF NOT EXISTS "funding_calls_embedding_voyage_1024_hnsw_idx"
    ON "funding_calls" USING hnsw ("embedding_voyage_1024" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  CREATE INDEX IF NOT EXISTS "funding_calls_embedding_hnsw_idx"
    ON "funding_calls" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

  DROP INDEX IF EXISTS "funding_calls_embedding_voyage_1024_idx";
  DROP INDEX IF EXISTS "funding_calls_embedding_idx";
END $$;
