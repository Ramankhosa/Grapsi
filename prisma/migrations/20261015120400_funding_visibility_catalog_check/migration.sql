-- External catalogue import, part 5: let GLOBAL_CATALOG calls exist.
--
-- The visibility/tenant check (20260415000000_phase1_project_tenant_foundation)
-- allows only GLOBAL_PUBLISHED-without-tenant and TENANT_PRIVATE-with-tenant.
-- It is replaced, in ONE statement and under the same name, by a strictly
-- wider check that also allows GLOBAL_CATALOG without a tenant. Every row that
-- satisfied the old check satisfies the new one; no row is read for change or
-- rewritten. Kept apart from part 4 because the new enum value cannot be used
-- in the transaction that added it.

-- Fail fast instead of queueing behind a long transaction on funding_calls.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "funding_calls"
  DROP CONSTRAINT "funding_calls_visibility_tenantId_check",
  ADD CONSTRAINT "funding_calls_visibility_tenantId_check" CHECK (
    (visibility = 'GLOBAL_PUBLISHED'::"FundingVisibility" AND "tenantId" IS NULL)
    OR (visibility = 'TENANT_PRIVATE'::"FundingVisibility" AND "tenantId" IS NOT NULL)
    OR (visibility = 'GLOBAL_CATALOG'::"FundingVisibility" AND "tenantId" IS NULL)
  );
