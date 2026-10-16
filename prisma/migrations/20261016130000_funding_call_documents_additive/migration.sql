-- Funding-call documents are additive (fundingDocumentService.uploadDocument:
-- "a call can hold several active documents at once ... only a true
-- re-upload supersedes the previous version", since f5a2cc0, 12 Aug 2026),
-- but the partial unique index from 20260702110000 still allowed one active
-- document per call, so every second upload for a call failed with a unique
-- violation (no call on dev holds more than one active document). Found when
-- catalogue enrichment tried to add a call's PDFs next to its official page.
--
-- Dropping an index removes no data; the CREATE UNIQUE INDEX statement in
-- 20260702110000 restores it. Re-uploads are still deduplicated by the
-- (funding_call_id, checksum) and (funding_call_id, version) unique keys.

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS "funding_call_documents_one_active_idx";
