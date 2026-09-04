-- The funding department's "period of consideration": the window faculty
-- workload and submissions are counted in. Nullable so every existing tenant
-- keeps today's behaviour (readers fall back to the current calendar year).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reporting_period_start" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reporting_period_end" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reporting_period_label" TEXT;
