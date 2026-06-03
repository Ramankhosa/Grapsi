CREATE TABLE IF NOT EXISTS "recommendation_query_embedding_cache" (
  "id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "input_mode" TEXT NOT NULL,
  "semantic_document" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "embedding_version" TEXT NOT NULL,
  "task_type" TEXT NOT NULL,
  "output_dimensionality" INTEGER NOT NULL,
  "embedding" vector(768) NOT NULL,
  "hit_count" INTEGER NOT NULL DEFAULT 1,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recommendation_query_embedding_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rec_query_embedding_cache_key"
  ON "recommendation_query_embedding_cache"("request_hash", "model", "embedding_version", "task_type", "output_dimensionality");

CREATE INDEX IF NOT EXISTS "idx_recommendation_query_embedding_cache_last_used_at"
  ON "recommendation_query_embedding_cache"("last_used_at");

CREATE INDEX IF NOT EXISTS "recommendation_query_embedding_cache_embedding_idx"
  ON "recommendation_query_embedding_cache" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 25);
