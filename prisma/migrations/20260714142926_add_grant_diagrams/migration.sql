/*
  Warnings:

  - You are about to drop the `app_runtime_settings` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GrantDiagramKind" AS ENUM ('GANTT', 'FLOWCHART', 'LOGIC_MODEL', 'CHART', 'PLOT', 'SKETCH');

-- CreateEnum
CREATE TYPE "GrantDiagramStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'FAILED');

-- DropIndex
DROP INDEX "funded_project_raw_sources_source_project_id_idx";

-- DropIndex
DROP INDEX "public_projects_source_key_last_seen_at_idx";

-- AlterTable
ALTER TABLE "funded_project_raw_sources" ALTER COLUMN "raw_payload_json" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "idea_intelligence_runs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "idea_intelligence_sessions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "idea_intelligence_versions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "idea_refinement_candidates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public_project_research_areas" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "app_runtime_settings";

-- CreateTable
CREATE TABLE "grant_diagrams" (
    "id" TEXT NOT NULL,
    "grantSessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionKey" TEXT,
    "figureNo" INTEGER NOT NULL,
    "kind" "GrantDiagramKind" NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "themeKey" TEXT NOT NULL DEFAULT 'classic',
    "specJson" JSONB,
    "status" "GrantDiagramStatus" NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "imagePath" TEXT,
    "imageFormat" TEXT,
    "imageVersion" INTEGER NOT NULL DEFAULT 0,
    "generationPrompt" TEXT,
    "sourceFingerprint" TEXT,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_diagrams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grant_diagrams_grantSessionId_sectionKey_idx" ON "grant_diagrams"("grantSessionId", "sectionKey");

-- CreateIndex
CREATE INDEX "grant_diagrams_tenantId_projectId_idx" ON "grant_diagrams"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "grant_diagrams_session_figure_no_unique" ON "grant_diagrams"("grantSessionId", "figureNo");

-- CreateIndex
CREATE INDEX "public_projects_source_key_last_seen_at_idx" ON "public_projects"("source_key", "last_seen_at");

-- AddForeignKey
ALTER TABLE "grant_diagrams" ADD CONSTRAINT "grant_diagrams_grantSessionId_fkey" FOREIGN KEY ("grantSessionId") REFERENCES "grant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "public_project_crawl_items_run_status_attempt_created_idx" RENAME TO "public_project_crawl_items_run_id_status_attempt_count_crea_idx";

-- RenameIndex
ALTER INDEX "public_project_research_areas_project_label_key" RENAME TO "public_project_research_areas_project_id_label_key";

-- RenameIndex
ALTER INDEX "public_project_research_areas_taxonomy_codes_idx" RENAME TO "public_project_research_areas_taxonomy_level1_code_taxonomy_idx";
