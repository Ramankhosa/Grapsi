-- Add funding-call ingestion stages to Super Admin LLM control.
-- Defaults:
-- - PDF transcription: Gemini 2.5 Pro
-- - URL/text structured extraction: DeepSeek V4 Pro

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
VALUES
  (
    'model-gemini-2-5-pro',
    'gemini-2.5-pro',
    'Gemini 2.5 Pro',
    'google',
    2097152,
    true,
    true,
    125,
    500,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'model-deepseek-v4-pro',
    'deepseek-v4-pro',
    'DeepSeek V4 Pro',
    'deepseek',
    1000000,
    false,
    true,
    174,
    348,
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

INSERT INTO "workflow_stages" (
  "id",
  "code",
  "displayName",
  "featureCode",
  "description",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'stage-funding-call-ingest-pdf',
    'FUNDING_CALL_INGEST_PDF',
    'Call Ingestion PDF',
    'FUNDING_DISCOVERY',
    'Transcribes uploaded funding-call PDFs into normalized source text before structured extraction.',
    10,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'stage-funding-call-ingest-text',
    'FUNDING_CALL_INGEST_TEXT',
    'Call Ingestion Web & Text',
    'FUNDING_DISCOVERY',
    'Extracts structured funding-call facts from URL content, pasted text, and transcribed PDF text.',
    20,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "featureCode" = EXCLUDED."featureCode",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "plan_stage_model_configs" (
  "id",
  "planId",
  "stageId",
  "modelId",
  "fallbackModelIds",
  "maxTokensIn",
  "maxTokensOut",
  "temperature",
  "isActive",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('cfg-', p."id", '-funding-call-ingest-pdf'),
  p."id",
  s."id",
  m."id",
  NULL,
  2000000,
  16000,
  0.1,
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "plans" p
JOIN "workflow_stages" s ON s."code" = 'FUNDING_CALL_INGEST_PDF'
JOIN "llm_models" m ON m."code" = 'gemini-2.5-pro'
WHERE p."status" = 'ACTIVE'
ON CONFLICT ("planId", "stageId") DO NOTHING;

INSERT INTO "plan_stage_model_configs" (
  "id",
  "planId",
  "stageId",
  "modelId",
  "fallbackModelIds",
  "maxTokensIn",
  "maxTokensOut",
  "temperature",
  "isActive",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('cfg-', p."id", '-funding-call-ingest-text'),
  p."id",
  s."id",
  m."id",
  NULL,
  120000,
  12000,
  0,
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "plans" p
JOIN "workflow_stages" s ON s."code" = 'FUNDING_CALL_INGEST_TEXT'
JOIN "llm_models" m ON m."code" = 'deepseek-v4-pro'
WHERE p."status" = 'ACTIVE'
ON CONFLICT ("planId", "stageId") DO NOTHING;
