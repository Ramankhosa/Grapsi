-- Backfill any completed batch that contains a review-gated job.
UPDATE "funding_intake_batches" batch
SET
  "status" = 'needs_review'::"FundingIntakeBatchStatus",
  "updated_at" = CURRENT_TIMESTAMP
WHERE batch."status" = 'completed'::"FundingIntakeBatchStatus"
  AND EXISTS (
    SELECT 1
    FROM "funding_intake_jobs" job
    WHERE job."batch_id" = batch."id"
      AND job."status" = 'needs_review'
  );
