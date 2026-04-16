/*
  Warnings:

  - The values [EMBEDDINGS,RERANK] on the enum `FeatureCode` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('INDIVIDUAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "IdeaBankStatus" AS ENUM ('PUBLIC', 'RESERVED', 'LICENSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IdeaBankReservationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "StyleProfileStatus" AS ENUM ('NOT_LEARNED', 'LEARNING', 'LEARNED', 'NEEDS_MORE_DATA', 'FAILED');

-- CreateEnum
CREATE TYPE "StyleTrainingJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('SAMPLE', 'REFERENCE');

-- AlterEnum
BEGIN;
CREATE TYPE "FeatureCode_new" AS ENUM ('PRIOR_ART_SEARCH', 'PATENT_DRAFTING', 'DIAGRAM_GENERATION', 'IDEA_BANK', 'PERSONA_SYNC');
ALTER TABLE "features" ALTER COLUMN "code" TYPE "FeatureCode_new" USING ("code"::text::"FeatureCode_new");
ALTER TYPE "FeatureCode" RENAME TO "FeatureCode_old";
ALTER TYPE "FeatureCode_new" RENAME TO "FeatureCode";
DROP TYPE "FeatureCode_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskCode" ADD VALUE 'IDEA_BANK_ACCESS';
ALTER TYPE "TaskCode" ADD VALUE 'IDEA_BANK_RESERVE';
ALTER TYPE "TaskCode" ADD VALUE 'IDEA_BANK_EDIT';
ALTER TYPE "TaskCode" ADD VALUE 'PERSONA_SYNC_LEARN';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "type" "TenantType" NOT NULL DEFAULT 'ENTERPRISE';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roles" "UserRole"[] DEFAULT ARRAY['ANALYST']::"UserRole"[];

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_map_cells" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_map_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aggregation_snapshots" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "noveltyScore" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "perPatentCoverage" JSONB NOT NULL,
    "perFeatureUniqueness" JSONB NOT NULL,
    "integrationCheck" JSONB NOT NULL,
    "qualityFlags" JSONB NOT NULL,
    "riskFactors" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aggregation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_map_overrides" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "originalStatus" TEXT NOT NULL,
    "overriddenStatus" TEXT NOT NULL,
    "evidence" TEXT,
    "reason" TEXT NOT NULL,
    "overriddenBy" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_map_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_mapping_cache" (
    "id" TEXT NOT NULL,
    "ideaHash" TEXT NOT NULL,
    "batchHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "featureMaps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_mapping_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_bank_ideas" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "abstract" TEXT,
    "domainTags" TEXT[],
    "technicalField" TEXT,
    "noveltyScore" DOUBLE PRECISION,
    "status" "IdeaBankStatus" NOT NULL DEFAULT 'PUBLIC',
    "generatedBy" TEXT,
    "sourceBatchId" TEXT,
    "derivedFromIdeaId" TEXT,
    "keyFeatures" TEXT[],
    "potentialApplications" TEXT[],
    "priorArtSummary" TEXT,
    "createdBy" TEXT NOT NULL,
    "tenantId" TEXT,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "idea_bank_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_bank_reservations" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdeaBankReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "sentToNoveltySearch" BOOLEAN NOT NULL DEFAULT false,
    "sentToDrafting" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "idea_bank_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_bank_history" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "notes" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_bank_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "json" JSONB NOT NULL,
    "status" "StyleProfileStatus" NOT NULL DEFAULT 'NOT_LEARNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,

    CONSTRAINT "style_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_training_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "StyleTrainingJobStatus" NOT NULL DEFAULT 'PENDING',
    "inputsMetadata" JSONB,
    "metrics" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_training_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'SAMPLE',
    "filename" TEXT NOT NULL,
    "contentPtr" TEXT,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "hash" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "feature_map_cells_searchId_publicationNumber_feature_key" ON "feature_map_cells"("searchId", "publicationNumber", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "aggregation_snapshots_searchId_key" ON "aggregation_snapshots"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_map_overrides_searchId_publicationNumber_feature_key" ON "feature_map_overrides"("searchId", "publicationNumber", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "feature_mapping_cache_ideaHash_batchHash_promptVersion_key" ON "feature_mapping_cache"("ideaHash", "batchHash", "promptVersion");

-- CreateIndex
CREATE INDEX "idea_bank_ideas_status_idx" ON "idea_bank_ideas"("status");

-- CreateIndex
CREATE INDEX "idea_bank_ideas_domainTags_idx" ON "idea_bank_ideas"("domainTags");

-- CreateIndex
CREATE INDEX "idea_bank_ideas_technicalField_idx" ON "idea_bank_ideas"("technicalField");

-- CreateIndex
CREATE INDEX "idea_bank_ideas_createdBy_idx" ON "idea_bank_ideas"("createdBy");

-- CreateIndex
CREATE INDEX "idea_bank_ideas_tenantId_idx" ON "idea_bank_ideas"("tenantId");

-- CreateIndex
CREATE INDEX "idea_bank_reservations_userId_status_idx" ON "idea_bank_reservations"("userId", "status");

-- CreateIndex
CREATE INDEX "idea_bank_reservations_expiresAt_idx" ON "idea_bank_reservations"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idea_bank_reservations_ideaId_userId_key" ON "idea_bank_reservations"("ideaId", "userId");

-- CreateIndex
CREATE INDEX "idea_bank_history_ideaId_timestamp_idx" ON "idea_bank_history"("ideaId", "timestamp");

-- CreateIndex
CREATE INDEX "idea_bank_history_userId_idx" ON "idea_bank_history"("userId");

-- CreateIndex
CREATE INDEX "style_profiles_tenantId_userId_idx" ON "style_profiles"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "style_profiles_status_idx" ON "style_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "style_profiles_tenantId_userId_version_key" ON "style_profiles"("tenantId", "userId", "version");

-- CreateIndex
CREATE INDEX "style_training_jobs_tenantId_userId_idx" ON "style_training_jobs"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "style_training_jobs_status_idx" ON "style_training_jobs"("status");

-- CreateIndex
CREATE INDEX "documents_tenantId_userId_type_idx" ON "documents"("tenantId", "userId", "type");

-- CreateIndex
CREATE INDEX "documents_hash_idx" ON "documents"("hash");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_map_cells" ADD CONSTRAINT "feature_map_cells_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "novelty_search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregation_snapshots" ADD CONSTRAINT "aggregation_snapshots_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "novelty_search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_map_overrides" ADD CONSTRAINT "feature_map_overrides_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "novelty_search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_map_overrides" ADD CONSTRAINT "feature_map_overrides_searchId_publicationNumber_feature_fkey" FOREIGN KEY ("searchId", "publicationNumber", "feature") REFERENCES "feature_map_cells"("searchId", "publicationNumber", "feature") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_ideas" ADD CONSTRAINT "idea_bank_ideas_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_ideas" ADD CONSTRAINT "idea_bank_ideas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_ideas" ADD CONSTRAINT "idea_bank_ideas_derivedFromIdeaId_fkey" FOREIGN KEY ("derivedFromIdeaId") REFERENCES "idea_bank_ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_reservations" ADD CONSTRAINT "idea_bank_reservations_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "idea_bank_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_reservations" ADD CONSTRAINT "idea_bank_reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_history" ADD CONSTRAINT "idea_bank_history_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "idea_bank_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_bank_history" ADD CONSTRAINT "idea_bank_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_lockedBy_fkey" FOREIGN KEY ("lockedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_training_jobs" ADD CONSTRAINT "style_training_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_training_jobs" ADD CONSTRAINT "style_training_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
