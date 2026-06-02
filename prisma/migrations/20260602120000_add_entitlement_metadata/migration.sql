ALTER TABLE "tenant_plans"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "sourceRef" TEXT,
ADD COLUMN "metadata" JSONB,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "tenant_plans_source_sourceRef_key"
ON "tenant_plans"("source", "sourceRef");

CREATE INDEX "tenant_plans_tenantId_status_effectiveFrom_expiresAt_idx"
ON "tenant_plans"("tenantId", "status", "effectiveFrom", "expiresAt");
