-- AlterEnum
ALTER TYPE "DraftingSessionStatus" ADD VALUE 'RELATED_ART';

-- CreateTable
CREATE TABLE "related_art_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "paramsJson" JSONB,
    "resultsJson" JSONB,
    "ranBy" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "related_art_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "related_art_selections" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "sessionId" TEXT NOT NULL,
    "patentNumber" TEXT NOT NULL,
    "title" TEXT,
    "snippet" TEXT,
    "score" DECIMAL(5,2),
    "tags" TEXT[],
    "userNotes" TEXT,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "related_art_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "related_art_runs_sessionId_idx" ON "related_art_runs"("sessionId");

-- CreateIndex
CREATE INDEX "related_art_selections_runId_idx" ON "related_art_selections"("runId");

-- CreateIndex
CREATE INDEX "related_art_selections_sessionId_idx" ON "related_art_selections"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "related_art_selections_sessionId_patentNumber_runId_key" ON "related_art_selections"("sessionId", "patentNumber", "runId");

-- AddForeignKey
ALTER TABLE "related_art_runs" ADD CONSTRAINT "related_art_runs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "related_art_selections" ADD CONSTRAINT "related_art_selections_runId_fkey" FOREIGN KEY ("runId") REFERENCES "related_art_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "related_art_selections" ADD CONSTRAINT "related_art_selections_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
