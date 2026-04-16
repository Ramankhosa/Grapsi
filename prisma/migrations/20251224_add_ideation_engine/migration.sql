-- ============================================================================
-- IDEATION ENGINE Migration (Idempotent - Safe for production)
-- ============================================================================
-- NOTE: This migration requires 20251224_add_ideation_enums to run first.
-- That migration adds IDEATION to FeatureCode, ServiceType, and TaskCode enums.
-- ============================================================================

-- CreateEnum: Ideation Session Status (idempotent)
DO $$ BEGIN
    CREATE TYPE "IdeationSessionStatus" AS ENUM ('SEED_INPUT', 'CLARIFYING', 'CLASSIFYING', 'EXPANDING', 'EXPLORING', 'GENERATING', 'NOVELTY_CHECK', 'REVIEWING', 'COMPLETED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Invention Class (idempotent)
DO $$ BEGIN
    CREATE TYPE "InventionClass" AS ENUM ('PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS', 'COMPOSITION', 'SOFTWARE_ALGORITHM', 'BIOTECH_PHARMA', 'MANUFACTURING', 'SERVICE_WORKFLOW', 'HYBRID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Archetype (idempotent)
DO $$ BEGIN
    CREATE TYPE "Archetype" AS ENUM ('MECH', 'ELEC', 'SOFT', 'CHEM', 'BIO', 'MIXED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Fork Mode (idempotent)
DO $$ BEGIN
    CREATE TYPE "ForkMode" AS ENUM ('SINGLE', 'FORK', 'MERGE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Mind Map Node Type (idempotent)
DO $$ BEGIN
    CREATE TYPE "MindMapNodeType" AS ENUM ('SEED', 'COMPONENT', 'DIMENSION_FAMILY', 'DIMENSION_OPTION', 'OPERATOR', 'CONSTRAINT', 'IDEA_FRAME', 'EVIDENCE_CLUSTER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Mind Map Node State (idempotent)
DO $$ BEGIN
    CREATE TYPE "MindMapNodeState" AS ENUM ('EXPANDED', 'COLLAPSED', 'HIDDEN', 'REMOVED', 'SELECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Idea Frame Status (idempotent)
DO $$ BEGIN
    CREATE TYPE "IdeaFrameStatus" AS ENUM ('DRAFT', 'SHORTLISTED', 'REJECTED', 'EXPORTED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Saturation Level (idempotent)
DO $$ BEGIN
    CREATE TYPE "SaturationLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: Novelty Action (idempotent)
DO $$ BEGIN
    CREATE TYPE "NoveltyAction" AS ENUM ('KEEP', 'MUTATE_OPERATOR', 'MUTATE_DIMENSION', 'NARROW_MICRO_PROBLEM', 'ASK_USER_QUESTION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: Main Ideation Sessions (idempotent)
CREATE TABLE IF NOT EXISTS "ideation_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdeationSessionStatus" NOT NULL DEFAULT 'SEED_INPUT',
    "seedText" TEXT NOT NULL,
    "seedGoal" TEXT,
    "seedConstraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "normalizationJson" JSONB,
    "classificationJson" JSONB,
    "settingsJson" JSONB,
    "budgetCap" TEXT NOT NULL DEFAULT 'MEDIUM',
    "activeTracks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ideation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Mind Map Nodes (idempotent)
CREATE TABLE IF NOT EXISTS "mindmap_nodes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "type" "MindMapNodeType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "family" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "MindMapNodeState" NOT NULL DEFAULT 'COLLAPSED',
    "selectable" BOOLEAN NOT NULL DEFAULT true,
    "defaultExpanded" BOOLEAN NOT NULL DEFAULT false,
    "parentNodeId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "payloadJson" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "positionX" DOUBLE PRECISION,
    "positionY" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mindmap_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Mind Map Edges (idempotent)
CREATE TABLE IF NOT EXISTS "mindmap_edges" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "label" TEXT,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mindmap_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Combine Trays (idempotent)
CREATE TABLE IF NOT EXISTS "combine_trays" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "selectedComponents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedDimensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedOperators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipeIntent" TEXT NOT NULL DEFAULT 'divergent',
    "requestedCount" INTEGER NOT NULL DEFAULT 5,
    "recipeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combine_trays_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Idea Frames (idempotent)
CREATE TABLE IF NOT EXISTS "idea_frames" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ideaFrameJson" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "principle" TEXT NOT NULL,
    "technicalEffect" TEXT,
    "classLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operatorsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dimensionsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "componentsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "IdeaFrameStatus" NOT NULL DEFAULT 'DRAFT',
    "noveltyScore" INTEGER,
    "noveltySummaryJson" JSONB,
    "conceptSaturation" "SaturationLevel",
    "solutionSaturation" "SaturationLevel",
    "userNotes" TEXT,
    "userRating" INTEGER,
    "exportedToIdeaId" TEXT,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Evidence Results (idempotent)
CREATE TABLE IF NOT EXISTS "evidence_results" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ideaFrameId" TEXT,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "parsedJson" JSONB,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "relevanceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Ideation Search Cache (idempotent)
CREATE TABLE IF NOT EXISTS "ideation_search_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideation_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Ideation History (idempotent)
CREATE TABLE IF NOT EXISTS "ideation_history" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "stage" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "userId" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "modelUsed" TEXT,
    "durationMs" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideation_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Ideation Sessions indexes (idempotent)
CREATE INDEX IF NOT EXISTS "ideation_sessions_tenantId_idx" ON "ideation_sessions"("tenantId");
CREATE INDEX IF NOT EXISTS "ideation_sessions_userId_idx" ON "ideation_sessions"("userId");
CREATE INDEX IF NOT EXISTS "ideation_sessions_status_idx" ON "ideation_sessions"("status");

-- CreateIndex: Mind Map Nodes indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "mindmap_nodes_sessionId_nodeId_key" ON "mindmap_nodes"("sessionId", "nodeId");
CREATE INDEX IF NOT EXISTS "mindmap_nodes_sessionId_idx" ON "mindmap_nodes"("sessionId");
CREATE INDEX IF NOT EXISTS "mindmap_nodes_sessionId_type_idx" ON "mindmap_nodes"("sessionId", "type");
CREATE INDEX IF NOT EXISTS "mindmap_nodes_sessionId_state_idx" ON "mindmap_nodes"("sessionId", "state");

-- CreateIndex: Mind Map Edges indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "mindmap_edges_sessionId_fromNodeId_toNodeId_key" ON "mindmap_edges"("sessionId", "fromNodeId", "toNodeId");
CREATE INDEX IF NOT EXISTS "mindmap_edges_sessionId_idx" ON "mindmap_edges"("sessionId");

-- CreateIndex: Combine Trays indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "combine_trays_sessionId_key" ON "combine_trays"("sessionId");

-- CreateIndex: Idea Frames indexes (idempotent)
CREATE INDEX IF NOT EXISTS "idea_frames_sessionId_idx" ON "idea_frames"("sessionId");
CREATE INDEX IF NOT EXISTS "idea_frames_sessionId_status_idx" ON "idea_frames"("sessionId", "status");

-- CreateIndex: Evidence Results indexes (idempotent)
CREATE INDEX IF NOT EXISTS "evidence_results_sessionId_idx" ON "evidence_results"("sessionId");
CREATE INDEX IF NOT EXISTS "evidence_results_queryHash_idx" ON "evidence_results"("queryHash");
CREATE INDEX IF NOT EXISTS "evidence_results_ideaFrameId_idx" ON "evidence_results"("ideaFrameId");

-- CreateIndex: Ideation Search Cache indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "ideation_search_cache_cacheKey_key" ON "ideation_search_cache"("cacheKey");
CREATE INDEX IF NOT EXISTS "ideation_search_cache_cacheKey_idx" ON "ideation_search_cache"("cacheKey");
CREATE INDEX IF NOT EXISTS "ideation_search_cache_expiresAt_idx" ON "ideation_search_cache"("expiresAt");

-- CreateIndex: Ideation History indexes (idempotent)
CREATE INDEX IF NOT EXISTS "ideation_history_sessionId_idx" ON "ideation_history"("sessionId");
CREATE INDEX IF NOT EXISTS "ideation_history_sessionId_action_idx" ON "ideation_history"("sessionId", "action");

-- AddForeignKey: Ideation Sessions (idempotent)
DO $$ BEGIN
    ALTER TABLE "ideation_sessions" ADD CONSTRAINT "ideation_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ideation_sessions" ADD CONSTRAINT "ideation_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: Mind Map Nodes (idempotent)
DO $$ BEGIN
    ALTER TABLE "mindmap_nodes" ADD CONSTRAINT "mindmap_nodes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: Mind Map Edges (idempotent)
DO $$ BEGIN
    ALTER TABLE "mindmap_edges" ADD CONSTRAINT "mindmap_edges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: Combine Trays (idempotent)
DO $$ BEGIN
    ALTER TABLE "combine_trays" ADD CONSTRAINT "combine_trays_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: Idea Frames (idempotent)
DO $$ BEGIN
    ALTER TABLE "idea_frames" ADD CONSTRAINT "idea_frames_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: Evidence Results (idempotent)
DO $$ BEGIN
    ALTER TABLE "evidence_results" ADD CONSTRAINT "evidence_results_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "evidence_results" ADD CONSTRAINT "evidence_results_ideaFrameId_fkey" FOREIGN KEY ("ideaFrameId") REFERENCES "idea_frames"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: Ideation History (idempotent)
DO $$ BEGIN
    ALTER TABLE "ideation_history" ADD CONSTRAINT "ideation_history_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
