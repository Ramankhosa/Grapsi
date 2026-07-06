CREATE TABLE IF NOT EXISTS "app_runtime_settings" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "description" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_app_runtime_settings_updated_at"
  ON "app_runtime_settings" ("updated_at");
