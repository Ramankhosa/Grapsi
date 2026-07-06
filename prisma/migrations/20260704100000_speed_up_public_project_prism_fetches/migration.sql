CREATE INDEX IF NOT EXISTS "public_projects_source_key_last_seen_at_idx"
  ON "public_projects"("source_key", "last_seen_at" DESC);

CREATE INDEX IF NOT EXISTS "public_project_crawl_items_run_status_attempt_created_idx"
  ON "public_project_crawl_items"("run_id", "status", "attempt_count", "created_at");
