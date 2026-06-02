-- Add a first-class review state for batches that finished processing but still need curator input.
ALTER TYPE "FundingIntakeBatchStatus" ADD VALUE IF NOT EXISTS 'needs_review';
