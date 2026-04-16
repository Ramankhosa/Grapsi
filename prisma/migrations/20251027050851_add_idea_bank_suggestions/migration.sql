-- CreateTable
CREATE TABLE "idea_bank_suggestions" (
    "id" TEXT NOT NULL,
    "relatedArtRunId" TEXT NOT NULL,
    "modelVersion" TEXT,
    "ideaTitle" TEXT NOT NULL,
    "corePrinciple" TEXT NOT NULL,
    "expectedAdvantage" TEXT NOT NULL,
    "tags" TEXT[],
    "nonObviousExtension" TEXT NOT NULL,
    "sourceBatchIndex" INTEGER DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_bank_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_bank_suggestions_relatedArtRunId_idx" ON "idea_bank_suggestions"("relatedArtRunId");

-- AddForeignKey
ALTER TABLE "idea_bank_suggestions" ADD CONSTRAINT "idea_bank_suggestions_relatedArtRunId_fkey" FOREIGN KEY ("relatedArtRunId") REFERENCES "related_art_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
