-- Discipline mapping: schools <-> funding calls.
--
-- Two joins and one escape hatch:
--   tenant_org_unit_research_areas  gives an org unit its discipline identity
--   call_school_triage              records where a school stands on a call
--   tenant_org_units.keywords       local vocabulary the shared catalog misses
--
-- Relevance is the intersection of tenant_org_unit_research_areas with the
-- existing funding_call_research_area_taxonomies, resolved in
-- src/lib/funding/callUnitRelevance.ts.

-- AlterTable
ALTER TABLE "tenant_org_units" ADD COLUMN "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "tenant_org_unit_research_areas" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "org_unit_id" TEXT NOT NULL,
    "taxonomy_area_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_org_unit_research_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_school_triage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "org_unit_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_school_triage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tenant_org_unit_research_areas_tenant_unit" ON "tenant_org_unit_research_areas"("tenant_id", "org_unit_id");

-- CreateIndex
CREATE INDEX "idx_tenant_org_unit_research_areas_area" ON "tenant_org_unit_research_areas"("taxonomy_area_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_org_unit_research_areas_unit_area_key" ON "tenant_org_unit_research_areas"("org_unit_id", "taxonomy_area_id");

-- CreateIndex
CREATE INDEX "idx_call_school_triage_tenant_unit_status" ON "call_school_triage"("tenant_id", "org_unit_id", "status");

-- CreateIndex
CREATE INDEX "idx_call_school_triage_call" ON "call_school_triage"("funding_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_school_triage_call_unit_key" ON "call_school_triage"("funding_call_id", "org_unit_id");

-- AddForeignKey
ALTER TABLE "tenant_org_unit_research_areas" ADD CONSTRAINT "tenant_org_unit_research_areas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_org_unit_research_areas" ADD CONSTRAINT "tenant_org_unit_research_areas_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_org_unit_research_areas" ADD CONSTRAINT "tenant_org_unit_research_areas_taxonomy_area_id_fkey" FOREIGN KEY ("taxonomy_area_id") REFERENCES "research_area_taxonomy_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_org_unit_research_areas" ADD CONSTRAINT "tenant_org_unit_research_areas_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_school_triage" ADD CONSTRAINT "call_school_triage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_school_triage" ADD CONSTRAINT "call_school_triage_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_school_triage" ADD CONSTRAINT "call_school_triage_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "tenant_org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_school_triage" ADD CONSTRAINT "call_school_triage_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
