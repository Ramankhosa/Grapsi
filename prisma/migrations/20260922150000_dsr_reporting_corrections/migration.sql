ALTER TABLE dsr_actions ADD COLUMN category TEXT NOT NULL DEFAULT 'ROUTINE'
  CHECK (category IN ('ROUTINE','CORRECTIVE'));
ALTER TABLE dsr_actions ADD COLUMN failure_type TEXT;

-- Assignment and bounded-search observations are never a certified live match.
UPDATE funding_opportunity_matches SET is_current=false;

CREATE TABLE dsr_match_projection_state (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, complete BOOLEAN NOT NULL, unprofiled JSONB NOT NULL,
 refreshed_at TIMESTAMP(3) NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,school_id)
);

UPDATE funding_import_jobs j SET origin_school_id=s.id,origin_school_name=s.name,origin_school_source='INFERRED_CREATOR_PROFILE'
FROM researcher_profiles p JOIN tenant_org_units u ON u.id=p.org_unit_id
JOIN tenant_org_units s ON s.id=u.path[1]
WHERE j."createdByUserId"=p.user_id AND j."tenantId"=s.tenant_id AND s.is_active AND s.depth=0 AND j.origin_school_id IS NULL;

UPDATE funding_calls c SET origin_school_id=j.origin_school_id,origin_school_name=j.origin_school_name,origin_school_source=j.origin_school_source
FROM (SELECT DISTINCT ON ("fundingCallId") * FROM funding_import_jobs WHERE origin_school_id IS NOT NULL ORDER BY "fundingCallId","createdAt",id) j
WHERE c.id=j."fundingCallId" AND c."tenantId"=j."tenantId" AND c.origin_school_id IS NULL;

-- Calls without a surviving linked job can still be attributed from their
-- creator's current school, explicitly labelled as an inference.
UPDATE funding_calls c SET origin_school_id=s.id,origin_school_name=s.name,origin_school_source='INFERRED_CREATOR_PROFILE'
FROM researcher_profiles p JOIN tenant_org_units u ON u.id=p.org_unit_id
JOIN tenant_org_units s ON s.id=u.path[1]
WHERE c."createdByUserId"=p.user_id AND c."tenantId"=s.tenant_id
  AND s.is_active AND s.depth=0 AND c.origin_school_id IS NULL;

-- One intake duty per school, retaining evidence for duplicate submissions.
CREATE TABLE dsr_origin_overrides (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id),
 updated_at TIMESTAMP(3) NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,call_id)
);
CREATE VIEW dsr_origin_responsibilities AS
SELECT c."tenantId" AS tenant_id,c.id AS call_id,c.origin_school_id AS school_id,'call:'||c.id AS evidence_id,c.origin_school_source AS source,c."createdAt" AS arrived_at
FROM funding_calls c WHERE c."tenantId" IS NOT NULL AND c.origin_school_id IS NOT NULL
UNION ALL
SELECT j."tenantId",j."fundingCallId",j.origin_school_id,'import:'||j.id,j.origin_school_source,j."createdAt"
FROM funding_import_jobs j WHERE j."tenantId" IS NOT NULL AND j."fundingCallId" IS NOT NULL AND j.origin_school_id IS NOT NULL
UNION ALL
SELECT u."tenantId",j.linked_funding_call_id,j.origin_school_id,'intake:'||j.id,j.origin_school_source,j.created_at
FROM funding_intake_jobs j JOIN users u ON u.id=j.submitted_by_user_id
WHERE u."tenantId" IS NOT NULL AND j.linked_funding_call_id IS NOT NULL AND j.origin_school_id IS NOT NULL
UNION ALL
SELECT tenant_id,call_id,school_id,'correction:'||call_id,'CORRECTED_BY_DSR_HEAD',updated_at FROM dsr_origin_overrides;

CREATE TABLE dsr_responsibility_transfers (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 owner_user_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,school_id,call_id)
);
