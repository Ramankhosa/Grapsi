CREATE TABLE "catalog_ai_review_batches" (
 "id" TEXT NOT NULL PRIMARY KEY, "actor_id" TEXT NOT NULL, "model" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'QUEUED', "selection" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "catalog_ai_review_items" (
 "id" TEXT NOT NULL PRIMARY KEY, "batch_id" TEXT NOT NULL, "candidate_id" TEXT NOT NULL,
 "input_hash" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "lease_token" TEXT, "lease_until" TIMESTAMP(3), "result" JSONB, "usage" JSONB, "error" TEXT,
 "attempts" INTEGER NOT NULL DEFAULT 0, "approved_by" TEXT, "approved_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "catalog_ai_review_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "catalog_ai_review_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "catalog_ai_review_items_batch_id_candidate_id_key" ON "catalog_ai_review_items"("batch_id", "candidate_id");
CREATE INDEX "catalog_ai_review_items_batch_id_status_lease_until_idx" ON "catalog_ai_review_items"("batch_id", "status", "lease_until");
