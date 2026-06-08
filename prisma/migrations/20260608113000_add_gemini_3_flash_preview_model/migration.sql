-- Add the Gemini 3 Flash API model code to the LLM registry so cost metering
-- does not fall back when providers report gemini-3-flash-preview.

INSERT INTO "llm_models" (
  "id",
  "code",
  "displayName",
  "provider",
  "contextWindow",
  "supportsVision",
  "supportsStreaming",
  "inputCostPer1M",
  "outputCostPer1M",
  "isActive",
  "isDefault",
  "createdAt",
  "updatedAt"
)
VALUES (
  'model-gemini-3-flash-preview',
  'gemini-3-flash-preview',
  'Gemini 3 Flash Preview',
  'google',
  1048576,
  true,
  true,
  50,
  300,
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "provider" = EXCLUDED."provider",
  "contextWindow" = EXCLUDED."contextWindow",
  "supportsVision" = EXCLUDED."supportsVision",
  "supportsStreaming" = EXCLUDED."supportsStreaming",
  "inputCostPer1M" = EXCLUDED."inputCostPer1M",
  "outputCostPer1M" = EXCLUDED."outputCostPer1M",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
