-- CreateEnum
CREATE TYPE "NoveltySearchStatus" AS ENUM ('PENDING', 'STAGE_0_COMPLETED', 'STAGE_1_COMPLETED', 'STAGE_3_5_COMPLETED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NoveltySearchStage" AS ENUM ('STAGE_0', 'STAGE_1', 'STAGE_3_5', 'STAGE_4');

-- CreateTable
CREATE TABLE "novelty_search_runs" (
    "id" TEXT NOT NULL,
    "patentId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "NoveltySearchStatus" NOT NULL DEFAULT 'PENDING',
    "currentStage" "NoveltySearchStage" NOT NULL DEFAULT 'STAGE_0',
    "config" JSONB NOT NULL,
    "inventionDescription" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'IN',
    "filingType" TEXT NOT NULL DEFAULT 'utility',
    "stage0CompletedAt" TIMESTAMP(3),
    "stage0Results" JSONB,
    "stage1CompletedAt" TIMESTAMP(3),
    "stage1Results" JSONB,
    "stage35CompletedAt" TIMESTAMP(3),
    "stage35Results" JSONB,
    "stage4CompletedAt" TIMESTAMP(3),
    "stage4Results" JSONB,
    "reportUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novelty_search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novelty_search_llm_calls" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "stage" "NoveltySearchStage" NOT NULL,
    "taskCode" "TaskCode" NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" JSONB,
    "tokensUsed" INTEGER,
    "modelClass" TEXT,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "novelty_search_llm_calls_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "novelty_search_runs" ADD CONSTRAINT "novelty_search_runs_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novelty_search_runs" ADD CONSTRAINT "novelty_search_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novelty_search_llm_calls" ADD CONSTRAINT "novelty_search_llm_calls_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "novelty_search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
