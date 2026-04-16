-- ============================================================================
-- ADD LITERATURE SEARCH RUN MODEL & LITERATURE_RELEVANCE TASK CODE
-- Supports AI-assisted literature relevance analysis feature
-- ============================================================================

-- Add LITERATURE_RELEVANCE to TaskCode enum
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'LITERATURE_RELEVANCE';

-- Create LiteratureSearchRun table
CREATE TABLE "literature_search_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sources" TEXT[],
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "results" JSONB NOT NULL,
    "aiAnalysis" JSONB,
    "aiAnalyzedAt" TIMESTAMP(3),
    "aiModelUsed" TEXT,
    "aiTokensUsed" INTEGER,
    "researchQuestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "literature_search_runs_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "literature_search_runs_sessionId_idx" ON "literature_search_runs"("sessionId");
CREATE INDEX "literature_search_runs_createdAt_idx" ON "literature_search_runs"("createdAt");

-- Add foreign key constraint
ALTER TABLE "literature_search_runs" ADD CONSTRAINT "literature_search_runs_sessionId_fkey" 
    FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

