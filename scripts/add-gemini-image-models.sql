-- ============================================================================
-- Add Gemini Image Generation Models to LLM Control
-- 
-- Run this script on production to add the best Gemini models for sketch generation
-- 
-- Usage: 
--   psql -U your_user -d your_database -f add-gemini-image-models.sql
--   OR run via your database admin tool
-- ============================================================================

-- Insert Gemini 2.0 Flash Experimental (Best for image generation)
INSERT INTO llm_models (
  id, code, "displayName", provider, 
  "contextWindow", "supportsVision", "supportsStreaming",
  "inputCostPer1M", "outputCostPer1M",
  "isActive", "isDefault",
  "createdAt", "updatedAt"
) VALUES (
  'gemini-2.0-flash-exp-' || substr(gen_random_uuid()::text, 1, 8),
  'gemini-2.0-flash-exp',
  'Gemini 2.0 Flash Experimental (Best Image Output)',
  'google',
  1048576,  -- 1M context window
  true,     -- Supports vision/image
  true,     -- Supports streaming
  10,       -- $0.10 per 1M input tokens
  40,       -- $0.40 per 1M output tokens
  true,     -- Active
  false,    -- Not system default
  NOW(),
  NOW()
) ON CONFLICT (code) DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "contextWindow" = EXCLUDED."contextWindow",
  "supportsVision" = EXCLUDED."supportsVision",
  "updatedAt" = NOW();

-- Insert Gemini 2.0 Flash Thinking Experimental (Higher quality, slower)
INSERT INTO llm_models (
  id, code, "displayName", provider, 
  "contextWindow", "supportsVision", "supportsStreaming",
  "inputCostPer1M", "outputCostPer1M",
  "isActive", "isDefault",
  "createdAt", "updatedAt"
) VALUES (
  'gemini-2.0-flash-thinking-' || substr(gen_random_uuid()::text, 1, 8),
  'gemini-2.0-flash-thinking-exp',
  'Gemini 2.0 Flash Thinking (Higher Quality Reasoning)',
  'google',
  1048576,  -- 1M context window
  true,     -- Supports vision/image
  true,     -- Supports streaming
  30,       -- $0.30 per 1M input tokens
  120,      -- $1.20 per 1M output tokens
  true,     -- Active
  false,    -- Not system default
  NOW(),
  NOW()
) ON CONFLICT (code) DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "contextWindow" = EXCLUDED."contextWindow",
  "supportsVision" = EXCLUDED."supportsVision",
  "updatedAt" = NOW();

-- Insert Gemini Exp 1206 (Latest experimental)
INSERT INTO llm_models (
  id, code, "displayName", provider, 
  "contextWindow", "supportsVision", "supportsStreaming",
  "inputCostPer1M", "outputCostPer1M",
  "isActive", "isDefault",
  "createdAt", "updatedAt"
) VALUES (
  'gemini-exp-1206-' || substr(gen_random_uuid()::text, 1, 8),
  'gemini-exp-1206',
  'Gemini Experimental (Dec 2024)',
  'google',
  2097152,  -- 2M context window
  true,     -- Supports vision/image
  true,     -- Supports streaming
  10,       -- $0.10 per 1M input tokens
  40,       -- $0.40 per 1M output tokens
  true,     -- Active
  false,    -- Not system default
  NOW(),
  NOW()
) ON CONFLICT (code) DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "contextWindow" = EXCLUDED."contextWindow",
  "supportsVision" = EXCLUDED."supportsVision",
  "updatedAt" = NOW();

-- Verify the models were added
SELECT code, "displayName", provider, "supportsVision", "isActive" 
FROM llm_models 
WHERE code IN ('gemini-2.0-flash-exp', 'gemini-2.0-flash-thinking-exp', 'gemini-exp-1206')
ORDER BY code;

-- ============================================================================
-- OUTPUT: You should see 3 rows with the new Gemini models
-- ============================================================================






























