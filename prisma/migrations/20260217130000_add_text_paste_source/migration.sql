DO $$
BEGIN
  IF to_regtype('"ReferenceDocumentSource"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumlabel = 'TEXT_PASTE'
        AND enumtypid = to_regtype('"ReferenceDocumentSource"')
    ) THEN
      ALTER TYPE "ReferenceDocumentSource" ADD VALUE 'TEXT_PASTE';
    END IF;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
