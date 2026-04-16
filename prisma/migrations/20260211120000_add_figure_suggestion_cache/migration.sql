-- AlterTable: Add nullable JSON column to store AI-generated figure/diagram/sketch suggestions
-- so they persist across page refreshes and track usage status (pending/used/dismissed).
ALTER TABLE "drafting_sessions" ADD COLUMN "figure_suggestion_cache" JSONB;
