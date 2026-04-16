-- CreateEnum
CREATE TYPE "DraftingSessionStatus" AS ENUM ('IDEA_ENTRY', 'COMPONENT_PLANNER', 'FIGURE_PLANNER', 'DIAGRAM_GENERATOR', 'ANNEXURE_DRAFT', 'REVIEW_FIX', 'EXPORT_READY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER');

-- CreateEnum
CREATE TYPE "NumeralRange" AS ENUM ('HUNDREDS', 'TWO_HUNDREDS', 'THREE_HUNDREDS', 'FOUR_HUNDREDS', 'FIVE_HUNDREDS', 'SIX_HUNDREDS', 'SEVEN_HUNDREDS', 'EIGHT_HUNDREDS', 'NINE_HUNDREDS');

-- AlterTable
ALTER TABLE "prior_art_runs" ADD COLUMN     "level0Checked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level0Determination" "NoveltyDetermination",
ADD COLUMN     "level0ReportUrl" TEXT,
ADD COLUMN     "level0Results" JSONB;

-- CreateTable
CREATE TABLE "local_patents" (
    "id" SERIAL NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "kind" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "abstractOriginal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_patents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafting_sessions" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "DraftingSessionStatus" NOT NULL DEFAULT 'IDEA_ENTRY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "drafting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_records" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "problem" TEXT,
    "objectives" TEXT,
    "components" JSONB,
    "logic" TEXT,
    "inputs" TEXT,
    "outputs" TEXT,
    "variants" TEXT,
    "bestMethod" TEXT,
    "llmPromptUsed" TEXT,
    "llmResponse" JSONB,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_maps" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT false,
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "figure_plans" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "figureNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "figure_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagram_sources" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "figureNo" INTEGER NOT NULL,
    "plantumlCode" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "imageFilename" TEXT,
    "imagePath" TEXT,
    "imageChecksum" TEXT,
    "imageUploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagram_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annexure_drafts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "fieldOfInvention" TEXT,
    "background" TEXT,
    "summary" TEXT,
    "briefDescriptionOfDrawings" TEXT,
    "detailedDescription" TEXT,
    "bestMethod" TEXT,
    "claims" TEXT,
    "abstract" TEXT,
    "listOfNumerals" TEXT,
    "fullDraftText" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT false,
    "validationReport" JSONB,
    "llmPromptUsed" TEXT,
    "llmResponse" JSONB,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annexure_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafting_history" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "DraftingSessionStatus" NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "notes" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafting_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_patents_publicationNumber_key" ON "local_patents"("publicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "idea_records_sessionId_key" ON "idea_records"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "reference_maps_sessionId_key" ON "reference_maps"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "figure_plans_sessionId_figureNo_key" ON "figure_plans"("sessionId", "figureNo");

-- CreateIndex
CREATE UNIQUE INDEX "diagram_sources_sessionId_figureNo_key" ON "diagram_sources"("sessionId", "figureNo");

-- AddForeignKey
ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_records" ADD CONSTRAINT "idea_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_maps" ADD CONSTRAINT "reference_maps_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "figure_plans" ADD CONSTRAINT "figure_plans_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_sources" ADD CONSTRAINT "diagram_sources_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annexure_drafts" ADD CONSTRAINT "annexure_drafts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafting_history" ADD CONSTRAINT "drafting_history_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafting_history" ADD CONSTRAINT "drafting_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
