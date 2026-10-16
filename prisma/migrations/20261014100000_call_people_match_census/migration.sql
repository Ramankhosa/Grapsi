-- Call-to-people match census (v2).
--
-- The v1 census ran "calls in my areas" for every researcher and tiered each
-- call against that researcher's OWN best call, so everybody's top call was
-- "strong" however poor it was. A generic call sat near the top of most lists
-- and was reported as matching 100+ faculty, while the call window's live
-- ranking (reranked, absolute tiers) listed two weak people.
--
-- v2 scores each call against the tenant's people with the same reranked
-- pipeline the call window and researcher matching use, and the call window
-- reads these stored rows, so the count and the list are the same people.

-- One row per call: which inputs the stored matches were computed from.
CREATE TABLE dsr_call_match_state (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 version TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 basis TEXT NOT NULL,
 candidates INTEGER NOT NULL,
 matched INTEGER NOT NULL,
 refreshed_at TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
 PRIMARY KEY(tenant_id,call_id)
);

-- Reranker scores keyed by exactly what was scored (model + call text + the
-- person's document), so a profile edit re-scores that person only.
CREATE TABLE dsr_match_score_cache (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 input_hash TEXT NOT NULL,
 score DOUBLE PRECISION NOT NULL,
 scored_at TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
 PRIMARY KEY(tenant_id,call_id,user_id)
);

-- v1 rows stay as history but stop being "current": nothing counts them, and
-- the next census rewrites every pair it still finds (keeping first_seen_at).
UPDATE funding_opportunity_matches SET is_current=false WHERE source_version='person-call-census-v1';

-- Force every school's projection to rebuild under v2.
DELETE FROM dsr_match_projection_state;

CREATE INDEX IF NOT EXISTS idx_funding_opportunity_matches_call_school_current
  ON funding_opportunity_matches(tenant_id,funding_call_id,school_id) WHERE is_current;
