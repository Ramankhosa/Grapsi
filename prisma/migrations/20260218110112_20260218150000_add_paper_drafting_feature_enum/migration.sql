/*
  Warnings:

  - You are about to drop the column `researchTopicId` on the `drafting_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `allow_copy` on the `paper_writing_personas` table. All the data in the column will be lost.
  - You are about to drop the column `is_template` on the `paper_writing_personas` table. All the data in the column will be lost.
  - The `visibility` column on the `paper_writing_personas` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `createdBy` on the `trial_email_templates` table. All the data in the column will be lost.
  - You are about to drop the column `unsubscribedAt` on the `trial_unsubscribes` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[sessionId,figureNo,language]` on the table `diagram_sources` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "SketchMode" AS ENUM ('AUTO', 'GUIDED', 'REFINE');

-- CreateEnum
CREATE TYPE "SketchStatus" AS ENUM ('SUGGESTED', 'PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PersonaVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CitationImportSource" ADD VALUE 'MENDELEY_IMPORT';
ALTER TYPE "CitationImportSource" ADD VALUE 'ZOTERO_IMPORT';
ALTER TYPE "CitationImportSource" ADD VALUE 'ENDNOTE_IMPORT';
ALTER TYPE "CitationImportSource" ADD VALUE 'RIS_IMPORT';
ALTER TYPE "CitationImportSource" ADD VALUE 'LIBRARY_IMPORT';

-- AlterEnum
ALTER TYPE "FeatureCode" ADD VALUE 'PATENT_REVIEW';
ALTER TYPE "FeatureCode" ADD VALUE 'PAPER_DRAFTING';

-- AlterEnum
ALTER TYPE "TaskCode" ADD VALUE 'LLM1_CLAIM_REFINEMENT';

-- DropForeignKey
ALTER TABLE "drafting_sessions" DROP CONSTRAINT "drafting_sessions_researchTopicId_fkey";

-- DropForeignKey
ALTER TABLE "paper_writing_personas" DROP CONSTRAINT "paper_writing_personas_creator_fkey";

-- DropIndex
DROP INDEX "diagram_sources_sessionId_figureNo_key";

-- DropIndex
DROP INDEX "drafting_sessions_archetypeEvidenceStale_idx";

-- DropIndex
DROP INDEX "drafting_sessions_archetypeId_idx";

-- DropIndex
DROP INDEX "drafting_sessions_citationStyleId_idx";

-- DropIndex
DROP INDEX "drafting_sessions_literatureReviewStatus_idx";

-- DropIndex
DROP INDEX "drafting_sessions_paperTypeId_idx";

-- DropIndex
DROP INDEX "drafting_sessions_publicationVenueId_idx";

-- DropIndex
DROP INDEX "drafting_sessions_researchTopicId_idx";

-- AlterTable
ALTER TABLE "annexure_drafts" ADD COLUMN     "extraSections" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "ati_tokens" ADD COLUMN     "assignedRole" "UserRole",
ADD COLUMN     "assignedTeamId" TEXT;

-- AlterTable
ALTER TABLE "citation_style_definitions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "citations" ADD COLUMN     "abstract" TEXT;

-- AlterTable
ALTER TABLE "deep_analysis_jobs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "diagram_sources" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "originalImageFilename" TEXT,
ADD COLUMN     "originalImagePath" TEXT,
ADD COLUMN     "translatedFromDiagramId" TEXT;

-- AlterTable
ALTER TABLE "drafting_sessions" DROP COLUMN "researchTopicId",
ADD COLUMN     "figureSequence" JSONB,
ADD COLUMN     "figure_sequence_finalized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_multi_jurisdiction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reference_draft_complete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reference_draft_id" TEXT;

-- AlterTable
ALTER TABLE "evidence_cards" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "literature_search_runs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "paper_section_citation_validations" ALTER COLUMN "draftCitationKeys" DROP DEFAULT,
ALTER COLUMN "humanizedCitationKeys" DROP DEFAULT,
ALTER COLUMN "missingCitationKeys" DROP DEFAULT,
ALTER COLUMN "extraCitationKeys" DROP DEFAULT;

-- AlterTable
ALTER TABLE "paper_type_definitions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "paper_writing_personas" DROP COLUMN "allow_copy",
DROP COLUMN "is_template",
ADD COLUMN     "allowCopy" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "name" SET DATA TYPE TEXT,
DROP COLUMN "visibility",
ADD COLUMN     "visibility" "PersonaVisibility" NOT NULL DEFAULT 'PRIVATE',
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "paper_writing_samples" ALTER COLUMN "persona_name" SET DATA TYPE TEXT,
ALTER COLUMN "paper_type_code" SET DATA TYPE TEXT,
ALTER COLUMN "section_key" SET DATA TYPE TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "publication_venues" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "research_topics" ADD COLUMN     "dataCollection" TEXT,
ADD COLUMN     "expectedResults" TEXT,
ADD COLUMN     "experiments" TEXT,
ADD COLUMN     "field" TEXT,
ADD COLUMN     "limitations" TEXT,
ADD COLUMN     "methodologyApproach" TEXT,
ADD COLUMN     "methodologyJustification" TEXT,
ADD COLUMN     "novelty" TEXT,
ADD COLUMN     "problemStatement" TEXT,
ADD COLUMN     "researchGaps" TEXT,
ADD COLUMN     "sampleSize" TEXT,
ADD COLUMN     "subQuestions" TEXT[],
ADD COLUMN     "subfield" TEXT,
ADD COLUMN     "techniques" TEXT[],
ADD COLUMN     "tools" TEXT[],
ADD COLUMN     "topicDescription" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trial_email_templates" DROP COLUMN "createdBy",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "trial_unsubscribes" DROP COLUMN "unsubscribedAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "user_section_instructions" ALTER COLUMN "paper_type_code" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_service_access" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyQuota" INTEGER,
    "dailyQuota" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_service_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_service_quotas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyQuota" INTEGER,
    "dailyQuota" INTEGER,
    "currentMonthUsage" INTEGER NOT NULL DEFAULT 0,
    "currentDayUsage" INTEGER NOT NULL DEFAULT 0,
    "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_service_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_models" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL DEFAULT 128000,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "inputCostPer1M" INTEGER NOT NULL DEFAULT 0,
    "outputCostPer1M" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_stages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "featureCode" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_stage_model_configs" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackModelIds" TEXT,
    "maxTokensIn" INTEGER,
    "maxTokensOut" INTEGER,
    "temperature" DOUBLE PRECISION DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_stage_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_task_model_configs" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskCode" "TaskCode" NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackModelIds" TEXT,
    "maxTokensIn" INTEGER,
    "maxTokensOut" INTEGER,
    "temperature" DOUBLE PRECISION DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_task_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patent_drafting_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hasDescription" BOOLEAN NOT NULL DEFAULT false,
    "hasClaims" BOOLEAN NOT NULL DEFAULT false,
    "isCounted" BOOLEAN NOT NULL DEFAULT false,
    "countedDate" TEXT,
    "countedMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "patent_drafting_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_completion_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completionDate" TEXT,
    "completionMonth" TEXT,
    "completedAt" TIMESTAMP(3),
    "inputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "outputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "totalTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_completion_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagram_generation_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "figureNo" INTEGER NOT NULL,
    "generationCount" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "countedDate" TEXT,
    "countedMonth" TEXT,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagram_generation_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sketch_generation_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sketchId" TEXT NOT NULL,
    "generationCount" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "countedDate" TEXT,
    "countedMonth" TEXT,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sketch_generation_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sketch_records" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "figureNo" INTEGER,
    "mode" "SketchMode" NOT NULL DEFAULT 'AUTO',
    "status" "SketchStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "userPrompt" TEXT,
    "contextFlags" JSONB,
    "sourceSketchId" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "viewsRequested" JSONB,
    "imagePath" TEXT,
    "imageFilename" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "imageChecksum" TEXT,
    "originalImagePath" TEXT,
    "originalImageFilename" TEXT,
    "aiModel" TEXT,
    "aiPromptUsed" TEXT,
    "aiResponseMeta" JSONB,
    "tokensUsed" INTEGER,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sketch_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_review_results" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "draft_id" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokens_used" INTEGER,
    "appliedFixes" JSONB NOT NULL DEFAULT '[]',
    "ignoredIssues" JSONB NOT NULL DEFAULT '[]',
    "userFeedback" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_review_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_personas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "PersonaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "allowCopy" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_samples" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personaId" TEXT,
    "personaName" TEXT NOT NULL DEFAULT 'Default',
    "jurisdiction" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "sampleText" TEXT NOT NULL,
    "notes" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_section_validations" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "max_words" INTEGER,
    "min_words" INTEGER,
    "recommended_words" INTEGER,
    "max_chars" INTEGER,
    "min_chars" INTEGER,
    "recommended_chars" INTEGER,
    "max_count" INTEGER,
    "max_independent" INTEGER,
    "count_before_extra_fee" INTEGER,
    "word_limit_severity" TEXT,
    "char_limit_severity" TEXT,
    "count_limit_severity" TEXT,
    "word_limit_message" TEXT,
    "char_limit_message" TEXT,
    "count_limit_message" TEXT,
    "legal_reference" TEXT,
    "additional_rules" JSONB DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_section_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_cross_validations" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "check_type" TEXT NOT NULL,
    "from_section" TEXT NOT NULL,
    "to_sections" TEXT[],
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "review_prompt" TEXT,
    "legal_basis" TEXT,
    "check_params" JSONB DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_cross_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_diagram_configs" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "required_when_applicable" BOOLEAN NOT NULL DEFAULT true,
    "supported_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "figure_label_format" TEXT NOT NULL DEFAULT 'Fig. {number}',
    "auto_reference_table" BOOLEAN NOT NULL DEFAULT true,
    "paper_size" TEXT NOT NULL DEFAULT 'A4',
    "color_allowed" BOOLEAN NOT NULL DEFAULT false,
    "color_usage_note" TEXT,
    "line_style" TEXT NOT NULL DEFAULT 'black_and_white_solid',
    "ref_numerals_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "min_ref_text_size_pt" INTEGER NOT NULL DEFAULT 8,
    "drawing_margin_top_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "drawing_margin_bottom_cm" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "drawing_margin_left_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "drawing_margin_right_cm" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "default_diagram_count" INTEGER NOT NULL DEFAULT 4,
    "max_diagrams_recommended" INTEGER NOT NULL DEFAULT 10,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_diagram_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_diagram_hints" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "diagram_type" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "preferred_syntax" TEXT,
    "example_code" TEXT,
    "max_elements" INTEGER,
    "require_labels" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_diagram_hints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_export_configs" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "page_size" TEXT NOT NULL DEFAULT 'A4',
    "margin_top_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_bottom_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "margin_left_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_right_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "font_family" TEXT NOT NULL DEFAULT 'Times New Roman',
    "font_size_pt" INTEGER NOT NULL DEFAULT 12,
    "line_spacing" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "heading_font_family" TEXT,
    "heading_font_size_pt" INTEGER,
    "add_page_numbers" BOOLEAN NOT NULL DEFAULT true,
    "add_paragraph_numbers" BOOLEAN NOT NULL DEFAULT false,
    "page_number_format" TEXT NOT NULL DEFAULT 'Page {page} of {total}',
    "page_number_position" TEXT NOT NULL DEFAULT 'header-right',
    "includes_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "section_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "export_options" JSONB DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_export_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_export_headings" (
    "id" TEXT NOT NULL,
    "export_config_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'uppercase',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_export_headings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_diagram_styles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "diagram_type" TEXT,
    "custom_hint" TEXT,
    "custom_color_allowed" BOOLEAN,
    "custom_line_style" TEXT,
    "custom_min_ref_text_size_pt" INTEGER,
    "custom_figure_label_format" TEXT,
    "preferred_diagram_count" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_diagram_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_export_styles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "font_family" TEXT,
    "font_size_pt" INTEGER,
    "line_spacing" DOUBLE PRECISION,
    "margin_top_cm" DOUBLE PRECISION,
    "margin_bottom_cm" DOUBLE PRECISION,
    "margin_left_cm" DOUBLE PRECISION,
    "margin_right_cm" DOUBLE PRECISION,
    "add_page_numbers" BOOLEAN,
    "add_paragraph_numbers" BOOLEAN,
    "custom_options" JSONB DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_export_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_validation_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "section_key" TEXT NOT NULL,
    "custom_max_words" INTEGER,
    "custom_max_chars" INTEGER,
    "custom_max_count" INTEGER,
    "custom_severity" TEXT,
    "override_reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_validation_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_config_imports" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "import_type" TEXT NOT NULL,
    "source_json" JSONB NOT NULL,
    "source_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "error_log" JSONB,
    "previous_state" JSONB,
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by" TEXT,
    "imported_by" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "country_config_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_tenantId_idx" ON "teams"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_tenantId_name_key" ON "teams"("tenantId", "name");

-- CreateIndex
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_service_access_teamId_serviceType_key" ON "team_service_access"("teamId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "user_service_quotas_userId_serviceType_key" ON "user_service_quotas"("userId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "llm_models_code_key" ON "llm_models"("code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_stages_code_key" ON "workflow_stages"("code");

-- CreateIndex
CREATE INDEX "plan_stage_model_configs_planId_idx" ON "plan_stage_model_configs"("planId");

-- CreateIndex
CREATE INDEX "plan_stage_model_configs_stageId_idx" ON "plan_stage_model_configs"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_stage_model_configs_planId_stageId_key" ON "plan_stage_model_configs"("planId", "stageId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_task_model_configs_planId_taskCode_key" ON "plan_task_model_configs"("planId", "taskCode");

-- CreateIndex
CREATE UNIQUE INDEX "patent_drafting_usage_sessionId_key" ON "patent_drafting_usage"("sessionId");

-- CreateIndex
CREATE INDEX "patent_drafting_usage_tenantId_countedDate_idx" ON "patent_drafting_usage"("tenantId", "countedDate");

-- CreateIndex
CREATE INDEX "patent_drafting_usage_tenantId_countedMonth_idx" ON "patent_drafting_usage"("tenantId", "countedMonth");

-- CreateIndex
CREATE INDEX "patent_drafting_usage_sessionId_idx" ON "patent_drafting_usage"("sessionId");

-- CreateIndex
CREATE INDEX "service_completion_usage_tenantId_serviceType_completionDat_idx" ON "service_completion_usage"("tenantId", "serviceType", "completionDate");

-- CreateIndex
CREATE INDEX "service_completion_usage_tenantId_serviceType_completionMon_idx" ON "service_completion_usage"("tenantId", "serviceType", "completionMonth");

-- CreateIndex
CREATE INDEX "service_completion_usage_userId_serviceType_idx" ON "service_completion_usage"("userId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "service_completion_usage_tenantId_serviceType_operationId_key" ON "service_completion_usage"("tenantId", "serviceType", "operationId");

-- CreateIndex
CREATE INDEX "diagram_generation_usage_tenantId_countedDate_idx" ON "diagram_generation_usage"("tenantId", "countedDate");

-- CreateIndex
CREATE INDEX "diagram_generation_usage_tenantId_countedMonth_idx" ON "diagram_generation_usage"("tenantId", "countedMonth");

-- CreateIndex
CREATE UNIQUE INDEX "diagram_generation_usage_tenantId_sessionId_figureNo_key" ON "diagram_generation_usage"("tenantId", "sessionId", "figureNo");

-- CreateIndex
CREATE INDEX "sketch_generation_usage_tenantId_countedDate_idx" ON "sketch_generation_usage"("tenantId", "countedDate");

-- CreateIndex
CREATE UNIQUE INDEX "sketch_generation_usage_tenantId_sessionId_sketchId_key" ON "sketch_generation_usage"("tenantId", "sessionId", "sketchId");

-- CreateIndex
CREATE INDEX "sketch_records_patentId_idx" ON "sketch_records"("patentId");

-- CreateIndex
CREATE INDEX "sketch_records_sessionId_idx" ON "sketch_records"("sessionId");

-- CreateIndex
CREATE INDEX "sketch_records_sourceSketchId_idx" ON "sketch_records"("sourceSketchId");

-- CreateIndex
CREATE INDEX "sketch_records_status_idx" ON "sketch_records"("status");

-- CreateIndex
CREATE INDEX "ai_review_results_session_id_jurisdiction_idx" ON "ai_review_results"("session_id", "jurisdiction");

-- CreateIndex
CREATE INDEX "ai_review_results_draft_id_idx" ON "ai_review_results"("draft_id");

-- CreateIndex
CREATE INDEX "writing_personas_tenantId_visibility_idx" ON "writing_personas"("tenantId", "visibility");

-- CreateIndex
CREATE INDEX "writing_personas_createdBy_idx" ON "writing_personas"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "writing_personas_createdBy_name_key" ON "writing_personas"("createdBy", "name");

-- CreateIndex
CREATE INDEX "writing_samples_tenantId_userId_idx" ON "writing_samples"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "writing_samples_userId_jurisdiction_idx" ON "writing_samples"("userId", "jurisdiction");

-- CreateIndex
CREATE INDEX "writing_samples_personaId_idx" ON "writing_samples"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "writing_samples_userId_jurisdiction_personaId_sectionKey_key" ON "writing_samples"("userId", "jurisdiction", "personaId", "sectionKey");

-- CreateIndex
CREATE INDEX "country_section_validations_country_code_idx" ON "country_section_validations"("country_code");

-- CreateIndex
CREATE INDEX "country_section_validations_section_key_idx" ON "country_section_validations"("section_key");

-- CreateIndex
CREATE UNIQUE INDEX "country_section_validations_country_code_section_key_key" ON "country_section_validations"("country_code", "section_key");

-- CreateIndex
CREATE INDEX "country_cross_validations_country_code_idx" ON "country_cross_validations"("country_code");

-- CreateIndex
CREATE INDEX "country_cross_validations_check_type_idx" ON "country_cross_validations"("check_type");

-- CreateIndex
CREATE UNIQUE INDEX "country_cross_validations_country_code_check_id_key" ON "country_cross_validations"("country_code", "check_id");

-- CreateIndex
CREATE UNIQUE INDEX "country_diagram_configs_country_code_key" ON "country_diagram_configs"("country_code");

-- CreateIndex
CREATE INDEX "country_diagram_configs_country_code_idx" ON "country_diagram_configs"("country_code");

-- CreateIndex
CREATE INDEX "country_diagram_hints_config_id_idx" ON "country_diagram_hints"("config_id");

-- CreateIndex
CREATE UNIQUE INDEX "country_diagram_hints_config_id_diagram_type_key" ON "country_diagram_hints"("config_id", "diagram_type");

-- CreateIndex
CREATE INDEX "country_export_configs_country_code_idx" ON "country_export_configs"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "country_export_configs_country_code_document_type_id_key" ON "country_export_configs"("country_code", "document_type_id");

-- CreateIndex
CREATE INDEX "country_export_headings_export_config_id_idx" ON "country_export_headings"("export_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "country_export_headings_export_config_id_section_key_key" ON "country_export_headings"("export_config_id", "section_key");

-- CreateIndex
CREATE INDEX "user_diagram_styles_user_id_idx" ON "user_diagram_styles"("user_id");

-- CreateIndex
CREATE INDEX "user_diagram_styles_session_id_idx" ON "user_diagram_styles"("session_id");

-- CreateIndex
CREATE INDEX "user_diagram_styles_tenant_id_idx" ON "user_diagram_styles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_diagram_styles_user_id_session_id_jurisdiction_diagram_key" ON "user_diagram_styles"("user_id", "session_id", "jurisdiction", "diagram_type");

-- CreateIndex
CREATE INDEX "user_export_styles_user_id_idx" ON "user_export_styles"("user_id");

-- CreateIndex
CREATE INDEX "user_export_styles_session_id_idx" ON "user_export_styles"("session_id");

-- CreateIndex
CREATE INDEX "user_export_styles_tenant_id_idx" ON "user_export_styles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_export_styles_user_id_session_id_jurisdiction_key" ON "user_export_styles"("user_id", "session_id", "jurisdiction");

-- CreateIndex
CREATE INDEX "user_validation_overrides_session_id_idx" ON "user_validation_overrides"("session_id");

-- CreateIndex
CREATE INDEX "user_validation_overrides_user_id_idx" ON "user_validation_overrides"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_validation_overrides_session_id_jurisdiction_section_k_key" ON "user_validation_overrides"("session_id", "jurisdiction", "section_key");

-- CreateIndex
CREATE INDEX "country_config_imports_country_code_idx" ON "country_config_imports"("country_code");

-- CreateIndex
CREATE INDEX "country_config_imports_status_idx" ON "country_config_imports"("status");

-- CreateIndex
CREATE INDEX "country_config_imports_imported_by_idx" ON "country_config_imports"("imported_by");

-- CreateIndex
CREATE INDEX "citation_style_definitions_code_idx" ON "citation_style_definitions"("code");

-- CreateIndex
CREATE INDEX "diagram_sources_sessionId_language_idx" ON "diagram_sources"("sessionId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "diagram_sources_sessionId_figureNo_language_key" ON "diagram_sources"("sessionId", "figureNo", "language");

-- CreateIndex
CREATE INDEX "paper_blueprints_sessionId_idx" ON "paper_blueprints"("sessionId");

-- CreateIndex
CREATE INDEX "paper_type_definitions_code_idx" ON "paper_type_definitions"("code");

-- CreateIndex
CREATE INDEX "paper_writing_personas_tenant_id_visibility_idx" ON "paper_writing_personas"("tenant_id", "visibility");

-- CreateIndex
CREATE INDEX "publication_venues_code_idx" ON "publication_venues"("code");

-- CreateIndex
CREATE INDEX "research_topics_sessionId_idx" ON "research_topics"("sessionId");

-- CreateIndex
CREATE INDEX "trial_unsubscribes_email_idx" ON "trial_unsubscribes"("email");

-- RenameForeignKey
ALTER TABLE "paper_writing_personas" RENAME CONSTRAINT "paper_writing_personas_tenant_fkey" TO "paper_writing_personas_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "paper_writing_samples" RENAME CONSTRAINT "paper_writing_samples_persona_fkey" TO "paper_writing_samples_persona_id_fkey";

-- RenameForeignKey
ALTER TABLE "paper_writing_samples" RENAME CONSTRAINT "paper_writing_samples_tenant_fkey" TO "paper_writing_samples_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "paper_writing_samples" RENAME CONSTRAINT "paper_writing_samples_user_fkey" TO "paper_writing_samples_user_id_fkey";

-- AddForeignKey
ALTER TABLE "ati_tokens" ADD CONSTRAINT "ati_tokens_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_service_access" ADD CONSTRAINT "team_service_access_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_service_quotas" ADD CONSTRAINT "user_service_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_stage_model_configs" ADD CONSTRAINT "plan_stage_model_configs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_stage_model_configs" ADD CONSTRAINT "plan_stage_model_configs_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "workflow_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_stage_model_configs" ADD CONSTRAINT "plan_stage_model_configs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_task_model_configs" ADD CONSTRAINT "plan_task_model_configs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_task_model_configs" ADD CONSTRAINT "plan_task_model_configs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patent_drafting_usage" ADD CONSTRAINT "patent_drafting_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completion_usage" ADD CONSTRAINT "service_completion_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completion_usage" ADD CONSTRAINT "service_completion_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_generation_usage" ADD CONSTRAINT "diagram_generation_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sketch_generation_usage" ADD CONSTRAINT "sketch_generation_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_sources" ADD CONSTRAINT "diagram_sources_translatedFromDiagramId_fkey" FOREIGN KEY ("translatedFromDiagramId") REFERENCES "diagram_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sketch_records" ADD CONSTRAINT "sketch_records_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sketch_records" ADD CONSTRAINT "sketch_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sketch_records" ADD CONSTRAINT "sketch_records_sourceSketchId_fkey" FOREIGN KEY ("sourceSketchId") REFERENCES "sketch_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_review_results" ADD CONSTRAINT "ai_review_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_review_results" ADD CONSTRAINT "ai_review_results_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "annexure_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_personas" ADD CONSTRAINT "writing_personas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_personas" ADD CONSTRAINT "writing_personas_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "writing_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_writing_personas" ADD CONSTRAINT "paper_writing_personas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_diagram_hints" ADD CONSTRAINT "country_diagram_hints_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "country_diagram_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_export_headings" ADD CONSTRAINT "country_export_headings_export_config_id_fkey" FOREIGN KEY ("export_config_id") REFERENCES "country_export_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_diagram_styles" ADD CONSTRAINT "user_diagram_styles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_diagram_styles" ADD CONSTRAINT "user_diagram_styles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_diagram_styles" ADD CONSTRAINT "user_diagram_styles_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_export_styles" ADD CONSTRAINT "user_export_styles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_export_styles" ADD CONSTRAINT "user_export_styles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_export_styles" ADD CONSTRAINT "user_export_styles_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_validation_overrides" ADD CONSTRAINT "user_validation_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_validation_overrides" ADD CONSTRAINT "user_validation_overrides_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_config_imports" ADD CONSTRAINT "country_config_imports_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "citation_usage_dim_map_uniq" RENAME TO "citation_usages_citationId_sectionKey_dimension_usageKind_key";

-- RenameIndex
ALTER INDEX "citations_session_id_deep_analysis_status_idx" RENAME TO "citations_sessionId_deepAnalysisStatus_idx";

-- RenameIndex
ALTER INDEX "country_section_mappings_country_section_key" RENAME TO "country_section_mappings_country_code_section_key_key";

-- RenameIndex
ALTER INDEX "paper_section_citation_validations_sessionId_sectionKey_checked" RENAME TO "paper_section_citation_validations_sessionId_sectionKey_che_idx";

-- RenameIndex
ALTER INDEX "paper_type_section_prompt_history_paper_type_code_section_key_i" RENAME TO "paper_type_section_prompt_history_paper_type_code_section_k_idx";

-- RenameIndex
ALTER INDEX "paper_type_section_unique" RENAME TO "paper_type_section_prompts_paper_type_code_section_key_key";

-- RenameIndex
ALTER INDEX "paper_writing_personas_creator_idx" RENAME TO "paper_writing_personas_created_by_idx";

-- RenameIndex
ALTER INDEX "paper_writing_personas_creator_name_key" RENAME TO "paper_writing_personas_created_by_name_key";

-- RenameIndex (REMOVED: index auto-dropped when "visibility" column was dropped above;
-- the replacement index is already created earlier in this migration as
-- paper_writing_personas_tenant_id_visibility_idx)

-- RenameIndex
ALTER INDEX "paper_writing_samples_persona_idx" RENAME TO "paper_writing_samples_persona_id_idx";

-- RenameIndex
ALTER INDEX "paper_writing_samples_tenant_user_idx" RENAME TO "paper_writing_samples_tenant_id_user_id_idx";

-- RenameIndex
ALTER INDEX "paper_writing_samples_unique" RENAME TO "paper_writing_samples_user_id_paper_type_code_persona_id_se_key";

-- RenameIndex
ALTER INDEX "paper_writing_samples_user_paper_type_idx" RENAME TO "paper_writing_samples_user_id_paper_type_code_idx";

-- RenameIndex
ALTER INDEX "user_section_instructions_paper_type_idx" RENAME TO "user_section_instructions_user_id_paper_type_code_section_k_idx";
