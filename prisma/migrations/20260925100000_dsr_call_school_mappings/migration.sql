-- One stored, dated row per school responsibility: this call is this school's
-- business. Until now relevance was recomputed on every read and only the
-- origin school was stored, so a relevant school saw a call only once one of
-- its researchers had been matched to it.
--
-- Add-only by design: reclassification never removes a row. Only the DSR head
-- ends a mapping, with a reason, and the row stays as history.
CREATE TABLE dsr_call_school_mappings (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK (source IN ('ORIGIN','INGESTION_DIRECT','INGESTION_KEYWORD','INGESTION_BROAD','ADDED_BY_HEAD','RECONSTRUCTED_FROM_WORK')),
 tier TEXT CHECK (tier IN ('direct','keyword','broad')),
 reason TEXT,
 is_origin BOOLEAN NOT NULL DEFAULT false,
 -- Same convention as every other dsr_* table: raw-SQL timestamps in the
 -- database session's time zone.
 mapped_at TIMESTAMP(3) NOT NULL DEFAULT now(),
 mapped_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 -- Written by the one-off backfill rather than at classification time. A
 -- backfilled row's mapped_at is either dated evidence (origin arrival, the
 -- earliest recorded work) or the backfill day — never an invented intake date.
 backfilled BOOLEAN NOT NULL DEFAULT false,
 is_active BOOLEAN NOT NULL DEFAULT true,
 ended_at TIMESTAMP(3),
 ended_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 ended_reason TEXT,
 PRIMARY KEY (tenant_id, call_id, school_id),
 CHECK (is_active OR (ended_at IS NOT NULL AND COALESCE(length(trim(ended_reason)),0) > 0)),
 CHECK (source = 'ADDED_BY_HEAD' OR source = 'RECONSTRUCTED_FROM_WORK' OR source = 'ORIGIN' OR tier IS NOT NULL)
);
CREATE INDEX dsr_call_school_mappings_school ON dsr_call_school_mappings(tenant_id, school_id, is_active, mapped_at);
CREATE INDEX dsr_call_school_mappings_call ON dsr_call_school_mappings(tenant_id, call_id);

-- Audit reads of one call's history (mapping, review, transfer) go through
-- dsr_events, which is keyed for entity lookups already; this covers the
-- per-call timeline across entity types.
CREATE INDEX IF NOT EXISTS dsr_events_mapping ON dsr_events(tenant_id, entity_id) WHERE entity_type IN ('MAPPING','REVIEW','RESPONSIBILITY');
