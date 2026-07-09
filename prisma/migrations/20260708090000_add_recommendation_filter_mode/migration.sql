-- Add per-conversation filter mode for the funding finder chat.
-- 'manual' (default): the assistant never changes filters; it can only suggest them.
-- 'auto': legacy behavior where the assistant applies extracted filters.
ALTER TABLE "recommendation_conversations"
ADD COLUMN IF NOT EXISTS "filter_mode" TEXT NOT NULL DEFAULT 'manual';
