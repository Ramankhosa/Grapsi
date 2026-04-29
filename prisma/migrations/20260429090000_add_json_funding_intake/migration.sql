DO $$
BEGIN
  ALTER TYPE "FundingInputType" ADD VALUE 'json';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
