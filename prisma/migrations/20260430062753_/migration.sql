-- AlterTable
ALTER TABLE "funding_import_jobs" ALTER COLUMN "visibility" DROP DEFAULT;

-- AlterTable
ALTER TABLE "grant_blueprints" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "grant_prep_messages" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "grant_prep_sessions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "grant_section_drafts" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "grant_structured_field_responses" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "recommendation_conversations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "recommendation_query_enrichment_cache" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "researcher_notification_preferences" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "researcher_profiles" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "researcher_saved_research_areas" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reviewer_calls" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reviewer_section_grant_links" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "funding_calls_agency_name_idx" ON "funding_calls"("agency_name");

-- CreateIndex
CREATE INDEX "funding_calls_scheme_title_idx" ON "funding_calls"("scheme_title");

-- CreateIndex
CREATE INDEX "funding_calls_funder_country_idx" ON "funding_calls"("funder_country");

-- CreateIndex
CREATE INDEX "funding_calls_expiration_date_idx" ON "funding_calls"("expiration_date");

-- CreateIndex
CREATE INDEX "funding_calls_is_active_idx" ON "funding_calls"("is_active");
