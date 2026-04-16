-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ATITokenStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ISSUED', 'REVOKED', 'EXPIRED', 'USED_UP');

-- CreateEnum
CREATE TYPE "ApplicantCategory" AS ENUM ('natural_person', 'small_entity', 'startup', 'others');

-- CreateEnum
CREATE TYPE "Jurisdiction" AS ENUM ('IN', 'PCT', 'US', 'EP');

-- CreateEnum
CREATE TYPE "FilingRoute" AS ENUM ('national', 'pct_international', 'pct_national');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('startup', 'small_entity', 'university', 'regular');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "FeatureCode" AS ENUM ('PRIOR_ART_SEARCH', 'PATENT_DRAFTING', 'DIAGRAM_GENERATION', 'EMBEDDINGS', 'RERANK');

-- CreateEnum
CREATE TYPE "TaskCode" AS ENUM ('LLM1_PRIOR_ART', 'LLM2_DRAFT', 'LLM3_DIAGRAM', 'LLM4_NOVELTY_SCREEN', 'LLM5_NOVELTY_ASSESS');

-- CreateEnum
CREATE TYPE "ModelClass" AS ENUM ('BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DRAFTING', 'PRIOR_ART');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PriorArtSearchMode" AS ENUM ('LLM', 'MANUAL');

-- CreateEnum
CREATE TYPE "PriorArtSearchStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PriorArtQueryLabel" AS ENUM ('BROAD', 'BASELINE', 'NARROW');

-- CreateEnum
CREATE TYPE "PriorArtRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CREDIT_EXHAUSTED');

-- CreateEnum
CREATE TYPE "PriorArtIntersectionType" AS ENUM ('NONE', 'I2', 'I3');

-- CreateEnum
CREATE TYPE "NoveltyAssessmentStatus" AS ENUM ('PENDING', 'STAGE1_SCREENING', 'STAGE1_COMPLETED', 'STAGE2_ASSESSMENT', 'STAGE2_COMPLETED', 'NOVEL', 'NOT_NOVEL', 'DOUBT_RESOLVED', 'FAILED');

-- CreateEnum
CREATE TYPE "NoveltyDetermination" AS ENUM ('NOVEL', 'NOT_NOVEL', 'PARTIALLY_NOVEL', 'DOUBT');

-- CreateEnum
CREATE TYPE "NoveltyAssessmentStage" AS ENUM ('STAGE1_SCREENING', 'STAGE2_ASSESSMENT');

-- CreateEnum
CREATE TYPE "PriorArtContentType" AS ENUM ('PATENT', 'SCHOLAR');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "atiId" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "signupAtiTokenId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'ANALYST',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ati_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "rawToken" TEXT,
    "rawTokenExpiry" TIMESTAMP(3),
    "fingerprint" TEXT NOT NULL,
    "status" "ATITokenStatus" NOT NULL DEFAULT 'ISSUED',
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "planTier" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ati_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "tenantId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "ip" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_profiles" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "applicantLegalName" TEXT NOT NULL,
    "applicantCategory" "ApplicantCategory" NOT NULL,
    "applicantAddressLine1" TEXT NOT NULL,
    "applicantAddressLine2" TEXT,
    "applicantCity" TEXT NOT NULL,
    "applicantState" TEXT NOT NULL,
    "applicantCountryCode" TEXT NOT NULL,
    "applicantPostalCode" TEXT NOT NULL,
    "correspondenceName" TEXT NOT NULL,
    "correspondenceEmail" TEXT NOT NULL,
    "correspondencePhone" TEXT NOT NULL,
    "correspondenceAddressLine1" TEXT NOT NULL,
    "correspondenceAddressLine2" TEXT,
    "correspondenceCity" TEXT NOT NULL,
    "correspondenceState" TEXT NOT NULL,
    "correspondenceCountryCode" TEXT NOT NULL,
    "correspondencePostalCode" TEXT NOT NULL,
    "useAgent" BOOLEAN NOT NULL DEFAULT false,
    "agentName" TEXT,
    "agentRegistrationNo" TEXT,
    "agentEmail" TEXT,
    "agentPhone" TEXT,
    "agentAddressLine1" TEXT,
    "agentAddressLine2" TEXT,
    "agentCity" TEXT,
    "agentState" TEXT,
    "agentCountryCode" TEXT,
    "agentPostalCode" TEXT,
    "defaultJurisdiction" "Jurisdiction" NOT NULL,
    "defaultRoute" "FilingRoute" NOT NULL,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'EN',
    "defaultEntityStatusIn" "EntityStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_collaborators" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collaborator',
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patents" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annexure_versions" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "html" TEXT NOT NULL,
    "textPlain" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annexure_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "config" JSONB,
    "resultSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_notifications" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "token_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "code" "FeatureCode" NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "monthlyQuota" INTEGER,
    "dailyQuota" INTEGER,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "code" "TaskCode" NOT NULL,
    "name" TEXT NOT NULL,
    "linkedFeatureId" TEXT NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_model_classes" (
    "id" TEXT NOT NULL,
    "code" "ModelClass" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "llm_model_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_llm_access" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskCode" "TaskCode" NOT NULL,
    "allowedClasses" TEXT NOT NULL,
    "defaultClassId" TEXT NOT NULL,

    CONSTRAINT "plan_llm_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_rules" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "taskCode" "TaskCode",
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT,
    "taskCode" "TaskCode",
    "reservedUnits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_meters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT,
    "taskCode" "TaskCode",
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "currentUsage" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "featureId" TEXT,
    "taskCode" "TaskCode",
    "modelClass" TEXT,
    "apiCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "apiCalls" INTEGER DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "idempotencyKey" TEXT,
    "reservationId" TEXT,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT,
    "taskCode" "TaskCode",
    "alertType" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_search_bundles" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "mode" "PriorArtSearchMode" NOT NULL,
    "status" "PriorArtSearchStatus" NOT NULL DEFAULT 'DRAFT',
    "briefRaw" TEXT,
    "inventionBrief" TEXT NOT NULL,
    "bundleData" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" TEXT NOT NULL DEFAULT 'v1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prior_art_search_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_search_history" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousData" JSONB,
    "newData" JSONB,
    "notes" TEXT,

    CONSTRAINT "prior_art_search_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_query_variants" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "label" "PriorArtQueryLabel" NOT NULL,
    "query" TEXT NOT NULL,
    "num" INTEGER NOT NULL DEFAULT 20,
    "page" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prior_art_query_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_runs" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "approvedBundle" JSONB NOT NULL,
    "status" "PriorArtRunStatus" NOT NULL DEFAULT 'RUNNING',
    "userId" TEXT NOT NULL,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 1,
    "apiCallsMade" INTEGER NOT NULL DEFAULT 0,
    "costEstimate" DECIMAL(10,4),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prior_art_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_query_variant_executions" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "label" "PriorArtQueryLabel" NOT NULL,
    "query" TEXT NOT NULL,
    "num" INTEGER NOT NULL DEFAULT 20,
    "pageTarget" INTEGER NOT NULL DEFAULT 1,
    "pageExecuted" INTEGER NOT NULL DEFAULT 1,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "resultsCount" INTEGER NOT NULL DEFAULT 0,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_query_variant_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_raw_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "pageNo" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_raw_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_raw_details" (
    "id" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_raw_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_patents" (
    "publicationNumber" TEXT NOT NULL,
    "title" TEXT,
    "abstract" TEXT,
    "language" TEXT,
    "publicationDate" TIMESTAMP(3),
    "priorityDate" TIMESTAMP(3),
    "filingDate" TIMESTAMP(3),
    "assignees" TEXT[],
    "inventors" TEXT[],
    "cpcs" TEXT[],
    "ipcs" TEXT[],
    "link" TEXT,
    "pdfLink" TEXT,
    "extras" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prior_art_patents_pkey" PRIMARY KEY ("publicationNumber")
);

-- CreateTable
CREATE TABLE "prior_art_variant_hits" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "rankInVariant" INTEGER NOT NULL,
    "snippet" TEXT,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_variant_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_patent_details" (
    "publicationNumber" TEXT NOT NULL,
    "claims" JSONB,
    "description" TEXT,
    "classifications" JSONB,
    "worldwideApplications" JSONB,
    "events" JSONB,
    "legalEvents" JSONB,
    "citationsPatent" JSONB,
    "citationsNPL" JSONB,
    "pdfLink" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_patent_details_pkey" PRIMARY KEY ("publicationNumber")
);

-- CreateTable
CREATE TABLE "prior_art_unified_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "contentType" "PriorArtContentType" NOT NULL DEFAULT 'PATENT',
    "scholarIdentifier" TEXT,
    "foundInVariants" TEXT[],
    "rankBroad" INTEGER,
    "rankBaseline" INTEGER,
    "rankNarrow" INTEGER,
    "intersectionType" "PriorArtIntersectionType" NOT NULL,
    "score" DECIMAL(5,4) NOT NULL,
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_unified_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_scholar_content" (
    "identifier" TEXT NOT NULL,
    "title" TEXT,
    "authors" TEXT[],
    "publication" TEXT,
    "year" INTEGER,
    "abstract" TEXT,
    "citationCount" INTEGER,
    "link" TEXT,
    "pdfLink" TEXT,
    "doi" TEXT,
    "source" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_scholar_content_pkey" PRIMARY KEY ("identifier")
);

-- CreateTable
CREATE TABLE "novelty_assessment_runs" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "runId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "NoveltyAssessmentStatus" NOT NULL DEFAULT 'PENDING',
    "inventionSummary" JSONB NOT NULL,
    "intersectingPatents" JSONB NOT NULL,
    "stage1CompletedAt" TIMESTAMP(3),
    "stage1Results" JSONB,
    "stage2CompletedAt" TIMESTAMP(3),
    "stage2Results" JSONB,
    "finalDetermination" "NoveltyDetermination",
    "finalRemarks" TEXT,
    "finalSuggestions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novelty_assessment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novelty_assessment_llm_calls" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "stage" "NoveltyAssessmentStage" NOT NULL,
    "taskCode" "TaskCode" NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" JSONB,
    "tokensUsed" INTEGER,
    "modelClass" TEXT,
    "determination" "NoveltyDetermination",
    "remarks" TEXT,
    "suggestions" TEXT,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "novelty_assessment_llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credits" (
    "userId" TEXT NOT NULL,
    "totalCredits" INTEGER NOT NULL DEFAULT 100,
    "usedCredits" INTEGER NOT NULL DEFAULT 0,
    "monthlyReset" TIMESTAMP(3) NOT NULL,
    "lastSearchAt" TIMESTAMP(3),
    "planTier" TEXT NOT NULL DEFAULT 'free',

    CONSTRAINT "user_credits_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_atiId_key" ON "tenants"("atiId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_profiles_projectId_key" ON "applicant_profiles"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_collaborators_projectId_userId_key" ON "project_collaborators"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "token_notifications_tokenId_userId_notificationType_key" ON "token_notifications"("tokenId", "userId", "notificationType");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_plans_tenantId_planId_effectiveFrom_key" ON "tenant_plans"("tenantId", "planId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "features_code_key" ON "features"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_featureId_key" ON "plan_features"("planId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_code_key" ON "tasks"("code");

-- CreateIndex
CREATE UNIQUE INDEX "llm_model_classes_code_key" ON "llm_model_classes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_llm_access_planId_taskCode_key" ON "plan_llm_access"("planId", "taskCode");

-- CreateIndex
CREATE UNIQUE INDEX "policy_rules_scope_scopeId_taskCode_key_key" ON "policy_rules"("scope", "scopeId", "taskCode", "key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_reservations_idempotencyKey_key" ON "usage_reservations"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "usage_meters_tenantId_featureId_taskCode_periodType_periodK_key" ON "usage_meters"("tenantId", "featureId", "taskCode", "periodType", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "prior_art_query_variants_bundleId_label_key" ON "prior_art_query_variants"("bundleId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "prior_art_query_variant_executions_runId_label_key" ON "prior_art_query_variant_executions"("runId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "prior_art_raw_details_publicationNumber_patentId_key" ON "prior_art_raw_details"("publicationNumber", "patentId");

-- CreateIndex
CREATE UNIQUE INDEX "prior_art_variant_hits_runId_variantId_publicationNumber_key" ON "prior_art_variant_hits"("runId", "variantId", "publicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "prior_art_unified_results_runId_publicationNumber_key" ON "prior_art_unified_results"("runId", "publicationNumber");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_signupAtiTokenId_fkey" FOREIGN KEY ("signupAtiTokenId") REFERENCES "ati_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ati_tokens" ADD CONSTRAINT "ati_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patents" ADD CONSTRAINT "patents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patents" ADD CONSTRAINT "patents_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annexure_versions" ADD CONSTRAINT "annexure_versions_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annexure_versions" ADD CONSTRAINT "annexure_versions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_plans" ADD CONSTRAINT "tenant_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_plans" ADD CONSTRAINT "tenant_plans_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linkedFeatureId_fkey" FOREIGN KEY ("linkedFeatureId") REFERENCES "features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_llm_access" ADD CONSTRAINT "plan_llm_access_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_llm_access" ADD CONSTRAINT "plan_llm_access_taskCode_fkey" FOREIGN KEY ("taskCode") REFERENCES "tasks"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_llm_access" ADD CONSTRAINT "plan_llm_access_defaultClassId_fkey" FOREIGN KEY ("defaultClassId") REFERENCES "llm_model_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_meters" ADD CONSTRAINT "usage_meters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_meters" ADD CONSTRAINT "usage_meters_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_taskCode_fkey" FOREIGN KEY ("taskCode") REFERENCES "tasks"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_alerts" ADD CONSTRAINT "quota_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_search_bundles" ADD CONSTRAINT "prior_art_search_bundles_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_search_bundles" ADD CONSTRAINT "prior_art_search_bundles_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_search_bundles" ADD CONSTRAINT "prior_art_search_bundles_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_search_history" ADD CONSTRAINT "prior_art_search_history_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "prior_art_search_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_search_history" ADD CONSTRAINT "prior_art_search_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_query_variants" ADD CONSTRAINT "prior_art_query_variants_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "prior_art_search_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_runs" ADD CONSTRAINT "prior_art_runs_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "prior_art_search_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_runs" ADD CONSTRAINT "prior_art_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_query_variant_executions" ADD CONSTRAINT "prior_art_query_variant_executions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "prior_art_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_raw_results" ADD CONSTRAINT "prior_art_raw_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "prior_art_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_variant_hits" ADD CONSTRAINT "prior_art_variant_hits_runId_fkey" FOREIGN KEY ("runId") REFERENCES "prior_art_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_variant_hits" ADD CONSTRAINT "prior_art_variant_hits_publicationNumber_fkey" FOREIGN KEY ("publicationNumber") REFERENCES "prior_art_patents"("publicationNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_patent_details" ADD CONSTRAINT "prior_art_patent_details_publicationNumber_fkey" FOREIGN KEY ("publicationNumber") REFERENCES "prior_art_patents"("publicationNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_art_unified_results" ADD CONSTRAINT "prior_art_unified_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "prior_art_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novelty_assessment_runs" ADD CONSTRAINT "novelty_assessment_runs_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novelty_assessment_runs" ADD CONSTRAINT "novelty_assessment_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novelty_assessment_llm_calls" ADD CONSTRAINT "novelty_assessment_llm_calls_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "novelty_assessment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
