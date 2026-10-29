-- Provider batch mode for paid Source Watch work (29 Oct 2026): requests wait for
-- a half-price provider batch instead of a synchronous call. A batched attempt is
-- BATCH_QUEUED, then BATCH_SUBMITTED, then settles like any other attempt.
ALTER TABLE "monitor_llm_attempts" ADD COLUMN "batch_id" TEXT,
ADD COLUMN "batch_request" JSONB;

CREATE TABLE "monitor_paid_batches" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "provider_job" TEXT,
    "state" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "attempt_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_polled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_paid_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "monitor_paid_batches_state_idx" ON "monitor_paid_batches"("state");
CREATE INDEX "monitor_llm_attempts_batch_id_idx" ON "monitor_llm_attempts"("batch_id");
