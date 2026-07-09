-- Access control: split the funding/grant product surface into first-class,
-- plan-gated feature codes so Starter/Pro/Enterprise plans can group them and
-- runtime enforcement (checkServiceAccess) can gate each module independently.

-- AlterEnum: FeatureCode (used by Feature.code / PlanFeature membership)
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'FUNDING_CHAT';
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'FUNDING_INTELLIGENCE';
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'GRANT_REVIEW';

-- AlterEnum: ServiceType (used by org-access-service enforceServiceAccess)
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'FUNDING_CHAT';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'FUNDING_INTELLIGENCE';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'GRANT_REVIEW';
