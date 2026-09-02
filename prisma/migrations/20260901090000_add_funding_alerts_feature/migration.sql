-- Funding Alerts as a separately sellable service: new plan-gated feature code.
-- Delivery (fundingAlertService dispatch + digests) only reaches users whose
-- tenant's active plan includes FUNDING_ALERTS; institutional tenants get it via
-- their plan, individual paying customers via their INDIVIDUAL tenant's
-- subscription plan.

-- AlterEnum: FeatureCode (used by Feature.code / PlanFeature membership)
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'FUNDING_ALERTS';
