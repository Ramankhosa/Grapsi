-- CreateEnum
CREATE TYPE "PaperSectionHumanizationStatus" AS ENUM ('NOT_STARTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'OUTDATED');

-- CreateTable
CREATE TABLE "paper_section_humanizations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "draftId" TEXT,
    "sectionKey" TEXT NOT NULL,
    "status" "PaperSectionHumanizationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT,
    "humanizedContent" TEXT,
    "errorMessage" TEXT,
    "sourceDraftFingerprint" TEXT,
    "sourceDraftWordCount" INTEGER,
    "sourceDraftUpdatedAt" TIMESTAMP(3),
    "humanizedWordCount" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "humanizedAt" TIMESTAMP(3),
    "citationValidationAt" TIMESTAMP(3),

    CONSTRAINT "paper_section_humanizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_section_citation_validations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "humanizationId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "humanizationVersion" INTEGER NOT NULL,
    "draftCitationKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "humanizedCitationKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "missingCitationKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "extraCitationKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isValid" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_section_citation_validations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paper_section_humanizations_sessionId_sectionKey_key" ON "paper_section_humanizations"("sessionId", "sectionKey");

-- CreateIndex
CREATE INDEX "paper_section_humanizations_sessionId_idx" ON "paper_section_humanizations"("sessionId");

-- CreateIndex
CREATE INDEX "paper_section_humanizations_sessionId_status_idx" ON "paper_section_humanizations"("sessionId", "status");

-- CreateIndex
CREATE INDEX "paper_section_humanizations_draftId_idx" ON "paper_section_humanizations"("draftId");

-- CreateIndex
CREATE INDEX "paper_section_citation_validations_sessionId_sectionKey_checkedAt_idx" ON "paper_section_citation_validations"("sessionId", "sectionKey", "checkedAt");

-- CreateIndex
CREATE INDEX "paper_section_citation_validations_humanizationId_checkedAt_idx" ON "paper_section_citation_validations"("humanizationId", "checkedAt");

-- AddForeignKey
ALTER TABLE "paper_section_humanizations" ADD CONSTRAINT "paper_section_humanizations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_section_humanizations" ADD CONSTRAINT "paper_section_humanizations_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "annexure_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_section_citation_validations" ADD CONSTRAINT "paper_section_citation_validations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_section_citation_validations" ADD CONSTRAINT "paper_section_citation_validations_humanizationId_fkey" FOREIGN KEY ("humanizationId") REFERENCES "paper_section_humanizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
