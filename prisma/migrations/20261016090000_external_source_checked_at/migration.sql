-- External catalogue: when the source last checked each record.
--
-- Additive: one nullable column on a table the import owns. "Source last
-- checked" previously only moved when a record's content changed.

SET LOCAL lock_timeout = '5s';

ALTER TABLE "external_source_records" ADD COLUMN "source_checked_at" TIMESTAMP(3);
