CREATE INDEX IF NOT EXISTS "public_projects_embedding_pickup_idx"
  ON "public_projects"("record_status", "embedding_status", "source_key", "last_seen_at" DESC);
