# Funding-call vector search benchmark

2026-10-16 · 8,356 vectors in `embedding_voyage_1024` · pgvector 0.8.0 · 50 queries, top 20. Workloads: **finder** (open, published, visible; half with a residence-country filter) and **broad** (every published, visible call, open or closed). Latency is server execution time from EXPLAIN ANALYZE.

| Workload | Method | Plan | p50 ms | p95 ms | Recall@20 |
|---|---|---|---|---|---|
| finder | exact scan | Seq Scan on funding_calls | 57.6 | 67.9 | 100.0% |
| finder | deployed index, default settings | Seq Scan on funding_calls | 34.2 | 45.7 | 100.0% |
| finder | deployed index + app settings (hnsw.ef_search = 100, hnsw.iterative_scan = 'relaxed_order') | Seq Scan on funding_calls | 35.2 | 66.5 | 100.0% |
| finder | IVFFlat trained on the data (lists=91), probes=10 + iterative | Seq Scan on funding_calls | 44.9 | 76.1 | 95.8% |
| broad | exact scan | Seq Scan on funding_calls | 91.4 | 101.3 | 100.0% |
| broad | deployed index, default settings | Index Scan using funding_calls_embedding_voyage_1024_hnsw_idx on funding_calls | 1.9 | 3.8 | 100.0% |
| broad | deployed index + app settings (hnsw.ef_search = 100, hnsw.iterative_scan = 'relaxed_order') | Index Scan using funding_calls_embedding_voyage_1024_hnsw_idx on funding_calls | 1.4 | 2.3 | 100.0% |
| broad | IVFFlat trained on the data (lists=91), probes=10 + iterative | Index Scan using bench_ivf on funding_calls | 1.3 | 1.7 | 95.1% |

## Before the change (same 50 queries, old IVFFlat index, measured 16 Oct 2026)

| Workload | Method | Plan | p50 ms | p95 ms | Recall@20 |
|---|---|---|---|---|---|
| broad | old IVFFlat lists=100 (built on an empty column), probes=1 | Index Scan using funding_calls_embedding_voyage_1024_idx | 2.2 | 5.3 | 32.0% |
| broad | old IVFFlat, probes=10 + iterative scan | Index Scan using funding_calls_embedding_voyage_1024_idx | 10.9 | 15.8 | 84.0% |
| broad | HNSW m=16 / ef_construction=64, ef_search=100 + iterative | Index Scan using bench_hnsw | 1.5 | 2.0 | 100.0% |

## What we learned

- **The old indexes were broken, not slow.** Both `funding_calls` IVFFlat
  indexes were created by the migrations that added their columns, so k-means
  ran on zero rows and the 100 centroids say nothing about the data. Whenever
  the planner chose the index (broad queries: every published call, open or
  closed), the top 20 kept only 32% of the true neighbours. Tuning probes only
  reached 84%.
- **The planner prefers the old index even when a better one exists.** With
  IVFFlat and HNSW both present, the broad query still used IVFFlat, so the
  replacement migration (`20261016100000_funding_call_vector_hnsw`) drops the
  two IVFFlat indexes. An index holds no data; the old CREATE INDEX statements
  restore them.
- **The finder's filtered query is an exact scan today.** About 2,300 of
  10,000 rows survive the open/published/visible filter, so Postgres scans
  them and sorts (~50 ms, 100% recall). That stays true until the table is
  much larger; the index matters for broad queries now and for the finder
  later.
- **HNSW needs query-time settings once it is used for filtered queries.**
  An HNSW scan yields `hnsw.ef_search` (default 40) neighbours before the WHERE
  clause runs. With the index forced, the finder filter at `LIMIT 60` returned
  **9 rows** on default settings and **60** with `ef_search = 100` +
  `iterative_scan = relaxed_order`. `src/lib/vectorSearch.ts`
  (`withVectorSearchSettings`) applies them with `SET LOCAL` around the finder
  query (`recommendationSearchService.searchByVector`), skipping any setting the
  installed pgvector does not have. Cost: ~15 ms per search for the
  transaction round trips.
- **HNSW needs no training**, so unlike IVFFlat it stays correct as the
  catalogue grows; no reindex is needed after an import. Build time on dev:
  ~3 s per index at 10k calls (blocks writes while it builds).

## Production

- Check `SELECT extversion FROM pg_extension WHERE extname = 'vector'`. HNSW
  needs >= 0.5; iterative scan needs >= 0.8 (without it, filtered queries that
  use the index can come back short, as above). On < 0.5 the migration leaves
  the indexes unchanged and prints a NOTICE.
- Apply the migration outside import or intake runs.
- Every other vector index in the schema (public projects, document chunks,
  researcher profiles, saved areas, reference library, query cache) is the same
  empty-trained IVFFlat lists=100. That is a separate fix.

Re-run: `node ./node_modules/tsx/dist/cli.cjs scripts/benchmark-call-vector-search.ts --queries 50 --out docs/vector-index-benchmark.md`
(candidate indexes are built inside a rolled-back transaction; nothing is left behind).
