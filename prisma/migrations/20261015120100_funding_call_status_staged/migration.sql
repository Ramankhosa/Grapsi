-- External catalogue import, part 2 of 3: the STAGED catalogue status.
--
-- Alone in its own migration on purpose (same reason as
-- 20260910140000_add_assignment_lapsed_status): Postgres allows ALTER TYPE ...
-- ADD VALUE inside the transaction Prisma wraps each file in, but the new
-- value cannot be USED in that same transaction. No row uses STAGED until the
-- importer runs, and every reader filters on PUBLISHED, so a STAGED call is
-- invisible everywhere until it is released.

ALTER TYPE "FundingCallStatus" ADD VALUE IF NOT EXISTS 'STAGED';
