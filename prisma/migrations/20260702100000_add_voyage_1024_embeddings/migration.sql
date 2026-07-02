CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "funding_calls"
  ADD COLUMN IF NOT EXISTS "embedding_voyage_1024" vector(1024);

CREATE INDEX IF NOT EXISTS "funding_calls_embedding_voyage_1024_idx"
  ON "funding_calls" USING ivfflat ("embedding_voyage_1024" vector_cosine_ops) WITH (lists = 100);

ALTER TABLE "researcher_saved_research_areas"
  ADD COLUMN IF NOT EXISTS "embedding_voyage_1024" vector(1024);

CREATE INDEX IF NOT EXISTS "researcher_saved_research_areas_embedding_voyage_1024_idx"
  ON "researcher_saved_research_areas" USING ivfflat ("embedding_voyage_1024" vector_cosine_ops) WITH (lists = 50);

ALTER TABLE "researcher_profiles"
  ADD COLUMN IF NOT EXISTS "normalized_text" TEXT,
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding" vector(768),
  ADD COLUMN IF NOT EXISTS "embedding_voyage_1024" vector(1024),
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT;

CREATE INDEX IF NOT EXISTS "researcher_profiles_embedding_idx"
  ON "researcher_profiles" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS "researcher_profiles_embedding_voyage_1024_idx"
  ON "researcher_profiles" USING ivfflat ("embedding_voyage_1024" vector_cosine_ops) WITH (lists = 50);

ALTER TABLE "reference_library"
  ADD COLUMN IF NOT EXISTS "funding_match_text" TEXT,
  ADD COLUMN IF NOT EXISTS "funding_match_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "funding_embedding" vector(768),
  ADD COLUMN IF NOT EXISTS "funding_embedding_voyage_1024" vector(1024),
  ADD COLUMN IF NOT EXISTS "funding_embedding_version" TEXT;

CREATE INDEX IF NOT EXISTS "reference_library_funding_embedding_idx"
  ON "reference_library" USING ivfflat ("funding_embedding" vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS "reference_library_funding_embedding_voyage_1024_idx"
  ON "reference_library" USING ivfflat ("funding_embedding_voyage_1024" vector_cosine_ops) WITH (lists = 50);

ALTER TABLE "recommendation_query_embedding_cache"
  ALTER COLUMN "embedding" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "embedding_voyage_1024" vector(1024);

CREATE INDEX IF NOT EXISTS "recommendation_query_embedding_cache_embedding_voyage_1024_idx"
  ON "recommendation_query_embedding_cache" USING ivfflat ("embedding_voyage_1024" vector_cosine_ops) WITH (lists = 25);
