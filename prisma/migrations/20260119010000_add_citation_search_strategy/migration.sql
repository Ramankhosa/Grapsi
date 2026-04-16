-- CreateEnum
CREATE TYPE "SearchStrategyStatus" AS ENUM ('DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SearchQueryCategory" AS ENUM ('CORE_CONCEPTS', 'DOMAIN_APPLICATION', 'METHODOLOGY', 'THEORETICAL_FOUNDATION', 'SURVEYS_REVIEWS', 'COMPETING_APPROACHES', 'RECENT_ADVANCES', 'GAP_IDENTIFICATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SearchQueryStatus" AS ENUM ('PENDING', 'SEARCHING', 'SEARCHED', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "citation_search_strategies" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "paperTitle" TEXT,
    "paperAbstract" TEXT,
    "keywords" TEXT[],
    "researchFocus" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiModelUsed" TEXT,
    "summary" TEXT,
    "estimatedPapers" INTEGER,
    "status" "SearchStrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citation_search_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citation_search_queries" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "category" "SearchQueryCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "suggestedSources" TEXT[],
    "suggestedYearFrom" INTEGER,
    "suggestedYearTo" INTEGER,
    "suggestedFilters" JSONB,
    "status" "SearchQueryStatus" NOT NULL DEFAULT 'PENDING',
    "searchedAt" TIMESTAMP(3),
    "resultsCount" INTEGER,
    "importedCount" INTEGER,
    "userNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citation_search_queries_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add strategyQueryId to literature_search_runs
ALTER TABLE "literature_search_runs" ADD COLUMN "strategyQueryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "citation_search_strategies_sessionId_key" ON "citation_search_strategies"("sessionId");

-- CreateIndex
CREATE INDEX "citation_search_strategies_sessionId_idx" ON "citation_search_strategies"("sessionId");

-- CreateIndex
CREATE INDEX "citation_search_strategies_status_idx" ON "citation_search_strategies"("status");

-- CreateIndex
CREATE INDEX "citation_search_queries_strategyId_idx" ON "citation_search_queries"("strategyId");

-- CreateIndex
CREATE INDEX "citation_search_queries_category_idx" ON "citation_search_queries"("category");

-- CreateIndex
CREATE INDEX "citation_search_queries_status_idx" ON "citation_search_queries"("status");

-- CreateIndex
CREATE INDEX "citation_search_queries_priority_idx" ON "citation_search_queries"("priority");

-- CreateIndex
CREATE INDEX "literature_search_runs_strategyQueryId_idx" ON "literature_search_runs"("strategyQueryId");

-- AddForeignKey
ALTER TABLE "citation_search_strategies" ADD CONSTRAINT "citation_search_strategies_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citation_search_queries" ADD CONSTRAINT "citation_search_queries_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "citation_search_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "literature_search_runs" ADD CONSTRAINT "literature_search_runs_strategyQueryId_fkey" FOREIGN KEY ("strategyQueryId") REFERENCES "citation_search_queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

