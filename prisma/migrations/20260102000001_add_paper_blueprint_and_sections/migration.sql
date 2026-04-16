-- ============================================================================
-- ADD PAPER BLUEPRINT AND SECTIONS SYSTEM
-- Coherence-by-construction for paper writing
-- ============================================================================

-- Create BlueprintStatus enum
CREATE TYPE "BlueprintStatus" AS ENUM ('DRAFT', 'FROZEN', 'REVISION_PENDING');

-- Create PaperSectionStatus enum
CREATE TYPE "PaperSectionStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'REGENERATING');

-- Create PaperBlueprint table
CREATE TABLE "paper_blueprints" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "thesisStatement" TEXT NOT NULL,
    "centralObjective" TEXT NOT NULL,
    "keyContributions" TEXT[],
    "sectionPlan" JSONB NOT NULL,
    "preferredTerms" JSONB,
    "narrativeArc" TEXT,
    "paperTypeCode" TEXT,
    "methodologyType" TEXT,
    "status" "BlueprintStatus" NOT NULL DEFAULT 'DRAFT',
    "frozenAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "changeLog" JSONB,
    "llmPromptUsed" TEXT,
    "llmResponse" TEXT,
    "llmTokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_blueprints_pkey" PRIMARY KEY ("id")
);

-- Create PaperSection table
CREATE TABLE "paper_sections" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER,
    "memory" JSONB,
    "blueprintVersion" INTEGER,
    "promptUsed" TEXT,
    "llmResponse" TEXT,
    "tokensUsed" INTEGER,
    "status" "PaperSectionStatus" NOT NULL DEFAULT 'DRAFT',
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_sections_pkey" PRIMARY KEY ("id")
);

-- Create unique indexes
CREATE UNIQUE INDEX "paper_blueprints_sessionId_key" ON "paper_blueprints"("sessionId");
CREATE UNIQUE INDEX "paper_sections_sessionId_sectionKey_key" ON "paper_sections"("sessionId", "sectionKey");

-- Create indexes for performance
CREATE INDEX "paper_blueprints_status_idx" ON "paper_blueprints"("status");
CREATE INDEX "paper_sections_sessionId_idx" ON "paper_sections"("sessionId");
CREATE INDEX "paper_sections_sectionKey_idx" ON "paper_sections"("sectionKey");
CREATE INDEX "paper_sections_status_idx" ON "paper_sections"("status");

-- Add foreign key constraints
ALTER TABLE "paper_blueprints" ADD CONSTRAINT "paper_blueprints_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paper_sections" ADD CONSTRAINT "paper_sections_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

