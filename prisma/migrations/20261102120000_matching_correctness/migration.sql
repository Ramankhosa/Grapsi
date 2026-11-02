-- Matching correctness (2 Nov 2026 audit).
--
-- A failed census used to overwrite the last good one with a "successful" zero.
-- The state row now records attempts separately from successes: refreshed_at
-- stays the last successful check, and a failure only touches the fields below.
ALTER TABLE dsr_call_match_state
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT false,
  -- A call whose first census failed has no successful check yet.
  ALTER COLUMN refreshed_at DROP NOT NULL;

-- What each stored score is: a reranker judgement or a raw retrieval similarity.
-- Report widths are absolute reranker cutoffs, so only 'rerank' rows count.
-- eligibility carries the shared assessment so reports can separate research
-- fit from known conflicts and unchecked facts.
ALTER TABLE funding_opportunity_matches
  ADD COLUMN IF NOT EXISTS score_basis TEXT,
  ADD COLUMN IF NOT EXISTS eligibility JSONB;

UPDATE funding_opportunity_matches m SET score_basis = s.basis
  FROM dsr_call_match_state s
 WHERE m.source = 'matching' AND m.score_basis IS NULL
   AND s.tenant_id = m.tenant_id AND s.call_id = m.funding_call_id;

-- Instant-email retries for definite delivery failures.
ALTER TABLE funding_call_alerts
  ADD COLUMN IF NOT EXISTS email_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_retry_at TIMESTAMP(3);
