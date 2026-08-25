#!/usr/bin/env node

/**
 * ============================================================================
 * SEED: LLM Models and Workflow Stages - PRODUCTION CONFIG
 * ============================================================================
 *
 * Seeds the database with:
 * 1. All available LLM models (Google, OpenAI, Anthropic, DeepSeek, Groq, Zhipu, Qwen, Voyage)
 * 2. The active grant-focused workflow stages used by the current pipeline
 * 3. PRODUCTION TOKEN LIMITS for all plans (same limits, different models per tier)
 *
 * PRODUCTION TOKEN LIMITS are standardized across all plans from Enterprise config.
 * Model selection varies by plan tier (Free/Pro/Enterprise).
 * Newly added models are seeded but not assigned to any work.
 *
 * Safe to run multiple times (idempotent - uses upsert).
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const FUNDING_FEATURE_DEF = {
  code: 'FUNDING_DISCOVERY',
  name: 'Funding Discovery',
  unit: 'calls'
};

const FUNDING_TASK_SEEDS = [
  {
    code: 'FUNDING_CALL_INGEST',
    name: 'Funding Call Ingestion',
    defaultStageCode: 'FUNDING_CALL_INGEST_TEXT'
  },
  {
    code: 'FUNDING_CHAT',
    name: 'AI Fund Finder Chat',
    defaultStageCode: 'FUNDING_CHAT_NARRATIVE'
  },
  {
    code: 'IDEA_INTELLIGENCE',
    name: 'Funding Idea Intelligence',
    defaultStageCode: 'IDEA_INTELLIGENCE_REPORT'
  },
  {
    code: 'FUNDING_TEMPLATE_EXTRACT',
    name: 'Funding Template Extraction',
    defaultStageCode: 'FUNDING_TEMPLATE_EXTRACT_TEXT'
  },
  {
    code: 'FUNDING_GUIDELINE_EXTRACT',
    name: 'Funding Guideline Extraction',
    defaultStageCode: 'FUNDING_GUIDELINE_EXTRACT_TEXT'
  }
];

const FUNDING_TASK_ACCESS_BY_PLAN = {
  FREE_PLAN: { allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
  PRO_PLAN: { allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
  ENTERPRISE_PLAN: { allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'PRO_L' }
};

const MODEL_CLASS_SEEDS = [
  { code: 'BASE_S', name: 'Base Small' },
  { code: 'BASE_M', name: 'Base Medium' },
  { code: 'PRO_M', name: 'Professional Medium' },
  { code: 'PRO_L', name: 'Professional Large' },
  { code: 'ADVANCED', name: 'Advanced' }
];

async function main() {
  console.log('[seed] Seeding LLM models and workflow stages...\n');

  // ============================================================================
  // STEP 1: Seed all available LLM models
  // ============================================================================
  console.log('[seed] Step 1: Seeding LLM model registry...\n');

  const models = [
    // === GOOGLE MODELS ===
    {
      code: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash (Nano Banana)',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 15,     // $0.15
      outputCostPer1M: 60,    // $0.60
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-2.5-flash-lite',
      displayName: 'Gemini 2.5 Flash Lite',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 10,     // $0.10
      outputCostPer1M: 40,    // $0.40
      isActive: true,
      isDefault: true  // System default - cost effective
    },
    {
      code: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 10,     // $0.10
      outputCostPer1M: 40,    // $0.40
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-2.0-flash-lite',
      displayName: 'Gemini 2.0 Flash Lite',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 8,      // $0.08
      outputCostPer1M: 30,    // $0.30
      isActive: true,
      isDefault: false
    },
    // Gemini 2.0 Experimental Models (best for image generation)
    {
      code: 'gemini-2.0-flash-exp',
      displayName: 'Gemini 2.0 Flash Experimental (Best Image Output)',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 10,     // $0.10
      outputCostPer1M: 40,    // $0.40
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-2.0-flash-thinking-exp',
      displayName: 'Gemini 2.0 Flash Thinking (Higher Quality Reasoning)',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 30,     // $0.30
      outputCostPer1M: 120,   // $1.20
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-exp-1206',
      displayName: 'Gemini Experimental 1206 (Good Image Capability)',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },
    // Gemini 1.5 Series
    {
      code: 'gemini-1.5-pro',
      displayName: 'Gemini 1.5 Pro',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,
      outputCostPer1M: 500,
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-1.5-flash',
      displayName: 'Gemini 1.5 Flash',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 8,      // $0.075
      outputCostPer1M: 30,    // $0.30
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-embedding-001',
      displayName: 'Gemini Embedding 001',
      provider: 'google',
      contextWindow: 2048,
      supportsVision: false,
      supportsStreaming: false,
      inputCostPer1M: 15,
      outputCostPer1M: 0,
      isActive: true,
      isDefault: false
    },
    // Voyage 4 embedding models share one embedding space, allowing the
    // lower-cost query model to retrieve documents embedded by the large model.
    // Pricing source: https://docs.voyageai.com/docs/pricing
    {
      code: 'voyage-4-lite',
      displayName: 'Voyage 4 Lite',
      provider: 'voyage',
      contextWindow: 32000,
      supportsVision: false,
      supportsStreaming: false,
      inputCostPer1M: 2,     // $0.02
      outputCostPer1M: 0,
      isActive: true,
      isDefault: false
    },
    {
      code: 'voyage-4-large',
      displayName: 'Voyage 4 Large',
      provider: 'voyage',
      contextWindow: 32000,
      supportsVision: false,
      supportsStreaming: false,
      inputCostPer1M: 12,    // $0.12
      outputCostPer1M: 0,
      isActive: true,
      isDefault: false
    },
    // Google - Image Generation Model (Nano Banana Pro - legacy)
    // Reference: https://ai.google.dev/gemini-api/docs/image-generation
    {
      code: 'gemini-3-pro-image-preview',
      displayName: 'Gemini 3 Pro Image Preview (Nano Banana Pro)',
      provider: 'google',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 400,   // $4.00 (image generation)
      isActive: true,
      isDefault: false
    },
    // Google - Nano Banana 2 (Gemini 3.1 Flash Image) - latest image generation
    // Pro-level quality with Flash-speed. 14-object consistency, improved text rendering,
    // extreme aspect ratios (up to 8:1), resolutions from 512px to 4K.
    // Reference: https://deepmind.google/models/gemini/image/
    {
      code: 'gemini-3.1-flash-image',
      displayName: 'Gemini 3.1 Flash Image (Nano Banana 2)',
      provider: 'google',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 75,     // $0.75 (Flash-tier pricing)
      outputCostPer1M: 300,   // $3.00 (image generation)
      isActive: true,
      isDefault: false
    },
    // Google - Gemini 3 Flash text model, exposed internally as Gemini 3.1 Flash
    // because the product family is 3.1 while the current API endpoint is
    // gemini-3-flash-preview.
    {
      code: 'gemini-3.1-flash',
      displayName: 'Gemini 3.1 Flash',
      provider: 'google',
      contextWindow: 1048576,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 50,     // $0.50
      outputCostPer1M: 300,   // $3.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-3-flash-preview',
      displayName: 'Gemini 3 Flash Preview',
      provider: 'google',
      contextWindow: 1048576,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 50,     // $0.50
      outputCostPer1M: 300,   // $3.00
      isActive: true,
      isDefault: false
    },
    // Google - Gemini 3 Pro (Preview) + Thinking Alias
    // Note: "thinking" is enabled via a request parameter (thinking_level) and
    // represented in our system as a model-code alias for easy selection.
    {
      code: 'gemini-3-pro-preview',
      displayName: 'Gemini 3 Pro Preview',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25 (placeholder)
      outputCostPer1M: 1000,  // $10.00 (placeholder)
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-3-pro-preview-thinking',
      displayName: 'Gemini 3 Pro Preview (Thinking)',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25 (placeholder)
      outputCostPer1M: 1000,  // $10.00 (placeholder)
      isActive: true,
      isDefault: false
    },
    // Google - Gemini 3.0 Nano Banana (Sketch generation model)
    {
      code: 'gemini-3.0-nano-banana',
      displayName: 'Gemini 3.0 Nano Banana (Sketch)',
      provider: 'google',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },

    // === OPENAI MODELS ===
    // GPT-4 Series
    {
      code: 'gpt-4o',
      displayName: 'GPT-4o',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 250,    // $2.50
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 15,     // $0.15
      outputCostPer1M: 60,    // $0.60
      isActive: true,
      isDefault: false
    },
    // GPT-5 Series
    {
      code: 'gpt-5',
      displayName: 'GPT-5',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.1',
      displayName: 'GPT-5.1',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 150,    // $1.50
      outputCostPer1M: 1200,  // $12.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.2',
      displayName: 'GPT-5.2',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 150,    // $1.50 (placeholder)
      outputCostPer1M: 1200,  // $12.00 (placeholder)
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.4',
      displayName: 'GPT-5.4',
      provider: 'openai',
      contextWindow: 1050000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 250,    // $2.50
      outputCostPer1M: 1500,  // $15.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.4-mini',
      displayName: 'GPT-5.4 Mini',
      provider: 'openai',
      contextWindow: 400000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 75,     // $0.75
      outputCostPer1M: 450,   // $4.50
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.4-nano',
      displayName: 'GPT-5.4 Nano',
      provider: 'openai',
      contextWindow: 400000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 125,   // $1.25
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.4-pro',
      displayName: 'GPT-5.4 Pro',
      provider: 'openai',
      contextWindow: 1050000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 3000,   // $30.00
      outputCostPer1M: 18000, // $180.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.5',
      displayName: 'GPT-5.5',
      provider: 'openai',
      contextWindow: 1050000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 500,    // $5.00
      outputCostPer1M: 3000,  // $30.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.5-pro',
      displayName: 'GPT-5.5 Pro',
      provider: 'openai',
      contextWindow: 1050000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 3000,   // $30.00
      outputCostPer1M: 18000, // $180.00
      isActive: true,
      isDefault: false
    },
    // OpenAI - "Thinking" aliases (translated to reasoning controls in provider request)
    {
      code: 'gpt-5.1-thinking',
      displayName: 'GPT-5.1 (Thinking)',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 150,    // $1.50 (placeholder)
      outputCostPer1M: 1200,  // $12.00 (placeholder)
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.2-thinking',
      displayName: 'GPT-5.2 (Thinking)',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 150,    // $1.50 (placeholder)
      outputCostPer1M: 1200,  // $12.00 (placeholder)
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5-mini',
      displayName: 'GPT-5 Mini',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 50,     // $0.50
      outputCostPer1M: 200,   // $2.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5-nano',
      displayName: 'GPT-5 Nano',
      provider: 'openai',
      contextWindow: 64000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 25,     // $0.25
      outputCostPer1M: 100,   // $1.00
      isActive: true,
      isDefault: false
    },
    // GPT-3.5 Series
    {
      code: 'gpt-3.5-turbo',
      displayName: 'GPT-3.5 Turbo',
      provider: 'openai',
      contextWindow: 16384,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 50,     // $0.50
      outputCostPer1M: 150,   // $1.50
      isActive: true,
      isDefault: false
    },
    // GPT-4 Turbo
    {
      code: 'gpt-4-turbo',
      displayName: 'GPT-4 Turbo',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 1000,   // $10.00
      outputCostPer1M: 3000,  // $30.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-4',
      displayName: 'GPT-4',
      provider: 'openai',
      contextWindow: 8192,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 3000,   // $30.00
      outputCostPer1M: 6000,  // $60.00
      isActive: true,
      isDefault: false
    },
    // o1 Reasoning Models
    {
      code: 'o1',
      displayName: 'OpenAI o1 (Reasoning)',
      provider: 'openai',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 1500,   // $15.00
      outputCostPer1M: 6000,  // $60.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'o1-mini',
      displayName: 'OpenAI o1 Mini',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: false,
      inputCostPer1M: 110,    // $1.10
      outputCostPer1M: 440,   // $4.40
      isActive: true,
      isDefault: false
    },
    {
      code: 'o1-preview',
      displayName: 'OpenAI o1 Preview',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 1500,   // $15.00
      outputCostPer1M: 6000,  // $60.00
      isActive: true,
      isDefault: false
    },

    // === ANTHROPIC MODELS ===
    // Provider supports: Claude 4.x and Claude 3.x model codes.
    {
      code: 'claude-opus-4-7',
      displayName: 'Claude Opus 4.7',
      provider: 'anthropic',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 500,    // $5.00
      outputCostPer1M: 2500,  // $25.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-opus-4-6',
      displayName: 'Claude Opus 4.6',
      provider: 'anthropic',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 500,    // $5.00
      outputCostPer1M: 2500,  // $25.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3-5-sonnet',
      displayName: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 300,    // $3.00
      outputCostPer1M: 1500,  // $15.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3.5-sonnet',
      displayName: 'Claude 3.5 Sonnet [Alias]',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 300,    // $3.00
      outputCostPer1M: 1500,  // $15.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3-5-haiku',
      displayName: 'Claude 3.5 Haiku',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 80,     // $0.80
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3.5-haiku',
      displayName: 'Claude 3.5 Haiku [Alias]',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 80,     // $0.80
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3-opus',
      displayName: 'Claude 3 Opus',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 1500,   // $15.00
      outputCostPer1M: 7500,  // $75.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-opus-4.5',
      displayName: 'Claude Opus 4.5',
      provider: 'anthropic',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 500,    // $5.00 (aligned with Opus 4.6 alias pricing)
      outputCostPer1M: 2500,  // $25.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-opus-4.6',
      displayName: 'Claude Opus 4.6 [Alias]',
      provider: 'anthropic',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 500,    // $5.00
      outputCostPer1M: 2500,  // $25.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3-sonnet',
      displayName: 'Claude 3 Sonnet',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 300,    // $3.00
      outputCostPer1M: 1500,  // $15.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3-haiku',
      displayName: 'Claude 3 Haiku',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 25,     // $0.25
      outputCostPer1M: 125,   // $1.25
      isActive: true,
      isDefault: false
    },

    // === DEEPSEEK MODELS ===
    {
      code: 'deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      provider: 'deepseek',
      contextWindow: 1000000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 174,    // $1.74
      outputCostPer1M: 348,   // $3.48
      isActive: true,
      isDefault: false
    },
    {
      code: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash (Max Reasoning)',
      provider: 'deepseek',
      contextWindow: 1000000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 14,     // $0.14
      outputCostPer1M: 28,    // $0.28
      isActive: true,
      isDefault: false
    },
    {
      code: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      provider: 'deepseek',
      contextWindow: 64000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 27,     // $0.27
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'deepseek-reasoner',
      displayName: 'DeepSeek Reasoner (R1)',
      provider: 'deepseek',
      contextWindow: 64000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 55,     // $0.55
      outputCostPer1M: 219,   // $2.19
      isActive: true,
      isDefault: false
    },

    // === GROQ MODELS (Fast inference) ===
    // Provider supports: llama-3.3-70b-versatile, llama-3.1-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
    {
      code: 'llama-3.3-70b-versatile',
      displayName: 'Llama 3.3 70B Versatile (Groq)',
      provider: 'groq',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 59,     // $0.59
      outputCostPer1M: 79,    // $0.79
      isActive: true,
      isDefault: false
    },
    {
      code: 'llama-3.1-70b-versatile',
      displayName: 'Llama 3.1 70B Versatile (Groq)',
      provider: 'groq',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 59,     // $0.59
      outputCostPer1M: 79,    // $0.79
      isActive: true,
      isDefault: false
    },
    {
      code: 'llama-3.1-8b-instant',
      displayName: 'Llama 3.1 8B Instant (Groq)',
      provider: 'groq',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 5,      // $0.05
      outputCostPer1M: 8,     // $0.08
      isActive: true,
      isDefault: false
    },
    {
      code: 'mixtral-8x7b-32768',
      displayName: 'Mixtral 8x7B (Groq)',
      provider: 'groq',
      contextWindow: 32768,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 27,     // $0.27
      outputCostPer1M: 27,    // $0.27
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemma2-9b-it',
      displayName: 'Gemma 2 9B IT (Groq)',
      provider: 'groq',
      contextWindow: 8192,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 20,    // $0.20
      isActive: true,
      isDefault: false
    },
    // Legacy Groq model codes (aliases for backwards compatibility)
    {
      code: 'groq-llama-3.3-70b',
      displayName: 'Llama 3.3 70B (Groq) [Alias]',
      provider: 'groq',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 59,
      outputCostPer1M: 79,
      isActive: true,
      isDefault: false
    },
    {
      code: 'groq-mixtral-8x7b',
      displayName: 'Mixtral 8x7B (Groq) [Alias]',
      provider: 'groq',
      contextWindow: 32768,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 27,
      outputCostPer1M: 27,
      isActive: true,
      isDefault: false
    },

    // === ZHIPU / Z.AI MODELS (GLM) ===
    {
      code: 'glm-5.1',
      displayName: 'GLM-5.1',
      provider: 'zhipu',
      contextWindow: 200000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 140,    // $1.40
      outputCostPer1M: 440,   // $4.40
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-5.2',
      displayName: 'GLM-5.2',
      provider: 'zhipu',
      contextWindow: 200000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 160,    // $1.60
      outputCostPer1M: 480,   // $4.80
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-5',
      displayName: 'GLM-5',
      provider: 'zhipu',
      contextWindow: 200000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 320,   // $3.20
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-5-turbo',
      displayName: 'GLM-5 Turbo',
      provider: 'zhipu',
      contextWindow: 200000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 120,    // $1.20
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-5v-turbo',
      displayName: 'GLM-5V Turbo',
      provider: 'zhipu',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 120,    // $1.20
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.7',
      displayName: 'GLM-4.7',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 320,   // $3.20
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.7-flash',
      displayName: 'GLM-4.7 Flash',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.7-flashx',
      displayName: 'GLM-4.7 FlashX',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.6',
      displayName: 'GLM-4.6',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 320,   // $3.20
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.6v',
      displayName: 'GLM-4.6V',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 320,   // $3.20
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.6v-flash',
      displayName: 'GLM-4.6V Flash',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.5',
      displayName: 'GLM-4.5 (retired)',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: false,
      isDefault: false
    },
    {
      code: 'glm-4.5-air',
      displayName: 'GLM-4.5 Air',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.5-x',
      displayName: 'GLM-4.5 X (invalid, use glm-4.5-airx)',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: false,
      isDefault: false
    },
    {
      code: 'glm-4.5-airx',
      displayName: 'GLM-4.5 AirX',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.5-flash',
      displayName: 'GLM-4.5 Flash',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'glm-4.5v',
      displayName: 'GLM-4.5V (invalid, use glm-4.6v)',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 60,     // $0.60
      outputCostPer1M: 180,   // $1.80
      isActive: false,
      isDefault: false
    },
    {
      code: 'glm-4-32b-0414-128k',
      displayName: 'GLM-4 32B 128K (Z.AI only, not on open.bigmodel.cn)',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 20,     // $0.20
      outputCostPer1M: 110,   // $1.10
      isActive: false,
      isDefault: false
    },

    // === QWEN MODELS ===
    {
      code: 'qwen2.5-72b-instruct',
      displayName: 'Qwen 2.5 72B Instruct',
      provider: 'qwen',
      contextWindow: 131072,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 140,    // $1.40
      outputCostPer1M: 560,   // $5.60
      isActive: true,
      isDefault: false
    }
  ];

  // Check if LLMModel table exists
  try {
    for (const model of models) {
      await prisma.lLMModel.upsert({
        where: { code: model.code },
        update: model,
        create: model
      });
      console.log(`  - ${model.displayName} (${model.provider})`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  [warn] LLMModel table does not exist yet. Skipping LLM model seeding.');
      console.log('  [hint] Run migrations first: npx prisma migrate deploy');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  // ============================================================================
  // STEP 2: Seed workflow stages
  // ============================================================================
  console.log('\n[seed] Step 2: Seeding workflow stages...\n');

  const stageSeeds = [
    {
      code: 'FUNDING_CALL_INGEST_PDF',
      displayName: 'Call Ingestion PDF',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 1,
      description: 'PDF transcription for funding-call intake before structured field extraction.',
      tokenLimits: { maxTokensIn: 200000, maxTokensOut: 32000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gemini-2.5-pro', ENTERPRISE_PLAN: 'gemini-2.5-pro' }
    },
    {
      code: 'FUNDING_CALL_INGEST_TEXT',
      displayName: 'Call Ingestion Web & Text',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 2,
      description: 'Structured funding-call facts extraction from URL content, pasted text, and transcribed PDF text.',
      tokenLimits: { maxTokensIn: 200000, maxTokensOut: 24000 },
      models: { FREE_PLAN: 'deepseek-v4-pro', PRO_PLAN: 'deepseek-v4-pro', ENTERPRISE_PLAN: 'deepseek-v4-pro' }
    },
    {
      code: 'FUNDING_CHAT_ORCHESTRATOR',
      displayName: 'AI Fund Finder Orchestrator',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 3,
      description: 'Classify and structure user funding-chat intent.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 6000 },
      models: { FREE_PLAN: 'gemini-2.0-flash-lite', PRO_PLAN: 'gemini-2.0-flash', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'FUNDING_CHAT_QUERY_ENRICHMENT',
      displayName: 'AI Fund Finder Query Enrichment',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 4,
      description: 'Expand research-area searches for retrieval.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 4000 },
      models: { FREE_PLAN: 'gemini-2.0-flash-lite', PRO_PLAN: 'gemini-2.0-flash', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'FUNDING_CHAT_NARRATIVE',
      displayName: 'AI Fund Finder Narrative',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 5,
      description: 'Generate grounded recommendation summaries and follow-up answers.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.0-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'FUNDING_CHAT_EMBEDDING',
      displayName: 'AI Fund Finder Query Embedding',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 6,
      description: 'Embed funding search queries for vector retrieval cost tracking.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 0 },
      models: { FREE_PLAN: 'voyage-4-lite', PRO_PLAN: 'voyage-4-lite', ENTERPRISE_PLAN: 'voyage-4-lite' }
    },
    {
      code: 'FUNDING_CHAT_ANSWER',
      displayName: 'AI Fund Finder Conversational Answer',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 17,
      description: 'Answer funding-strategy and general questions conversationally inside the finder chat.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 4000 },
      models: { FREE_PLAN: 'gemini-2.0-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'FUNDING_DOC_QA',
      displayName: 'Funding Document Q&A',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 18,
      description: 'Answer questions about a specific funding call grounded in its ingested document chunks.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 4000 },
      models: { FREE_PLAN: 'gemini-2.0-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'IDEA_INTELLIGENCE_STRUCTURE',
      displayName: 'Idea Intelligence Structuring',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 7,
      description: 'Convert free-form research ideas into searchable facets, keywords, and semantic queries.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.0-flash-lite', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'IDEA_INTELLIGENCE_EVIDENCE_MAP',
      displayName: 'Idea Intelligence Evidence Mapping',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 8,
      description: 'Map idea facets against funded projects, publications, patents, and web evidence.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'IDEA_INTELLIGENCE_REPORT',
      displayName: 'Idea Intelligence Positioning Brief',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 9,
      description: 'Generate evidence-grounded positioning recommendations and next steps from the cross-corpus matrix.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'IDEA_INTELLIGENCE_REFINE',
      displayName: 'Idea Intelligence Refinement',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 10,
      description: 'Generate refined idea versions from completed landscape analysis and user refinement goals.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'FUNDING_DOCUMENT_RETRIEVAL',
      displayName: 'Funding Document Query Embedding',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 11,
      description: 'Embed queries used to retrieve relevant funding-document chunks.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 0 },
      models: { FREE_PLAN: 'voyage-4-lite', PRO_PLAN: 'voyage-4-lite', ENTERPRISE_PLAN: 'voyage-4-lite' }
    },
    {
      code: 'FUNDING_DOCUMENT_CHUNK_EMBEDDING',
      displayName: 'Funding Document Chunk Embedding',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 12,
      description: 'Embed parsed funding-document chunks for vector retrieval.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 0 },
      models: { FREE_PLAN: 'voyage-4-large', PRO_PLAN: 'voyage-4-large', ENTERPRISE_PLAN: 'voyage-4-large' }
    },
    {
      code: 'FUNDING_TEMPLATE_EXTRACT_TEXT',
      displayName: 'Funding Template Text Extraction',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 13,
      description: 'Extract grant template structure from text assets.',
      tokenLimits: { maxTokensIn: 200000, maxTokensOut: 32000 },
      models: { FREE_PLAN: 'deepseek-v4-pro', PRO_PLAN: 'deepseek-v4-pro', ENTERPRISE_PLAN: 'deepseek-v4-pro' }
    },
    {
      code: 'FUNDING_TEMPLATE_EXTRACT_MULTIMODAL',
      displayName: 'Funding Template Multimodal Extraction',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 14,
      description: 'Extract grant template structure from PDF and image assets.',
      tokenLimits: { maxTokensIn: 200000, maxTokensOut: 32000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gemini-2.5-pro', ENTERPRISE_PLAN: 'gemini-2.5-pro' }
    },
    {
      code: 'FUNDING_GUIDELINE_EXTRACT_TEXT',
      displayName: 'Funding Guideline Extraction',
      featureCode: 'FUNDING_DISCOVERY',
      sortOrder: 15,
      description: 'Extract structured grant-writing guidelines from call text.',
      tokenLimits: { maxTokensIn: 200000, maxTokensOut: 24000 },
      models: { FREE_PLAN: 'deepseek-v4-pro', PRO_PLAN: 'deepseek-v4-pro', ENTERPRISE_PLAN: 'deepseek-v4-pro' }
    },
    {
      code: 'GRANT_PREP_CHAT',
      displayName: 'Grant Prep Chatbot',
      featureCode: 'GRANT_PREP',
      sortOrder: 0,
      description: 'Run the interactive Grant Prep coaching chat, marker extraction, response repair, and compact follow-up generation.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-3.1-flash', PRO_PLAN: 'gemini-3.1-flash', ENTERPRISE_PLAN: 'deepseek-v4-flash' }
    },
    {
      code: 'PAPER_BLUEPRINT_GEN',
      displayName: 'Grant Blueprint Planning',
      featureCode: 'GRANT_PREP',
      sortOrder: 1,
      description: 'Build the working grant blueprint, scope, contribution path, and must-cover dimensions from the active context.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'GRANT_BLUEPRINT_GEN',
      displayName: 'Grant Blueprint Dimensions',
      featureCode: 'GRANT_PREP',
      sortOrder: 2,
      description: 'Generate grant-specific blueprint dimensions, section framing, and evaluation anchors from prep context.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'RESEARCH_INTENT_LOCK',
      displayName: 'Research Intent Lock',
      featureCode: 'GRANT_PREP',
      sortOrder: 3,
      description: 'Lock the core grant intent, scope boundaries, and decision-critical assumptions before drafting.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5' }
    },
    {
      code: 'ARGUMENT_PLAN',
      displayName: 'Argument Plan',
      featureCode: 'GRANT_PREP',
      sortOrder: 4,
      description: 'Plan the argument sequence, evidence posture, and persuasive structure for the grant narrative.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'PAPER_ARCHETYPE_DETECTION',
      displayName: 'Evidence Archetype Detection',
      featureCode: 'GRANT_PREP',
      sortOrder: 5,
      description: 'Classify evidence and reference material into archetypes for downstream extraction and mapping.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-flash-lite', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },

    {
      code: 'LITERATURE_SEARCH',
      displayName: 'Literature Search Assist',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 1,
      description: 'Support literature review retrieval planning, search framing, and source-targeting prompts.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gemini-2.5-pro', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'SEARCH_STRATEGY_PLANNING',
      displayName: 'Search Strategy Planning',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 2,
      description: 'Turn the research problem and grant blueprint into a structured literature search strategy.',
      tokenLimits: { maxTokensIn: 40000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'SEARCH_QUERY_GENERATION',
      displayName: 'Search Query Generation',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 3,
      description: 'Generate database-ready query sets, synonyms, filters, and retrieval variants for literature search.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'PAPER_LITERATURE_SUMMARIZE',
      displayName: 'Literature Evidence Extraction',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 4,
      description: 'Extract structured evidence, claims, metrics, and limitations from full-text literature for grant use.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'PAPER_LITERATURE_GAP',
      displayName: 'Literature Gap Analysis',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 5,
      description: 'Identify evidence gaps, unresolved questions, and positioning opportunities from the literature base.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'LITERATURE_RELEVANCE',
      displayName: 'Literature Relevance Scoring',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 6,
      description: 'Rank and filter candidate papers against the active grant topic, blueprint, and search intent.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-flash-lite', PRO_PLAN: 'gpt-4o-mini', ENTERPRISE_PLAN: 'gpt-5-mini' }
    },
    {
      code: 'CITATION_BLUEPRINT_MAPPING',
      displayName: 'Citation-to-Blueprint Mapping',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 7,
      description: 'Map extracted evidence and citations onto blueprint dimensions, sections, and grant-use cases.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5-mini', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'PAPER_REVIEW_COHERENCE',
      displayName: 'Evidence Coherence Mapping',
      featureCode: 'SEARCH_STRATEGY',
      sortOrder: 8,
      description: 'Check coherence between extracted evidence, mapped citations, and the grant blueprint dimension structure.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },

    {
      code: 'PAPER_CREATE_SECTIONS',
      displayName: 'Grant Section Structuring',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 1,
      description: 'Reorganize selected draft text into coherent grant sections and subsections.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5' }
    },
    {
      code: 'PAPER_SECTION_DRAFT',
      displayName: 'Grant Draft Generation',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 2,
      description: 'Generate the primary evidence-grounded grant section draft from blueprint, evidence, and grant context.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'deepseek-v4-pro', PRO_PLAN: 'deepseek-v4-pro', ENTERPRISE_PLAN: 'deepseek-v4-pro' }
    },
    {
      code: 'PAPER_SECTION_GEN',
      displayName: 'Grant Draft Finalization',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 3,
      description: 'Finalize grant section drafts in compatibility and memory-aware flows while preserving blueprint and evidence fidelity.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'deepseek-v4-pro', PRO_PLAN: 'deepseek-v4-pro', ENTERPRISE_PLAN: 'deepseek-v4-pro' }
    },
    {
      code: 'PAPER_SECTION_IMPROVE',
      displayName: 'Grant Section Improvement',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 4,
      description: 'Run targeted section-level improvement passes, including cleanup, citation repair, and coherence fixes.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gpt-5.2', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'PAPER_MEMORY_EXTRACT',
      displayName: 'Grant Draft Memory Extraction',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 5,
      description: 'Extract compact structured draft memory for downstream grant-writing consistency across sections.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gpt-4o-mini', ENTERPRISE_PLAN: 'gpt-4o-mini' }
    },
    {
      code: 'PAPER_TEXT_ACTION',
      displayName: 'Grant Text Actions',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 6,
      description: 'Apply focused edit actions such as rewrite, condense, expand, or formalize on selected grant text.',
      tokenLimits: { maxTokensIn: 24000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'PAPER_FIGURE_SUGGESTION',
      displayName: 'Figure Suggestions',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 7,
      description: 'Suggest figures, charts, and diagrams that strengthen the grant story and evidence presentation.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'PAPER_CHART_GENERATOR',
      displayName: 'Chart Generator',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 8,
      description: 'Generate structured chart specifications for grant figures and quantitative summaries.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gpt-4o', PRO_PLAN: 'gemini-2.5-pro', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'PAPER_DIAGRAM_GENERATOR',
      displayName: 'Diagram Generator',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 9,
      description: 'Generate Mermaid or PlantUML diagrams that explain methods, workflows, or systems in the grant.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gpt-4o', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'PAPER_DIAGRAM_FROM_TEXT',
      displayName: 'Diagram From Text',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 10,
      description: 'Convert highlighted grant text directly into diagram specifications and visual structure.',
      tokenLimits: { maxTokensIn: 48000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gpt-4o', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2-thinking' }
    },
    {
      code: 'PAPER_SKETCH_GENERATION',
      displayName: 'Sketch Generation',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 11,
      description: 'Generate concept sketches and visual figure drafts for grant diagrams and illustrations.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 12000 },
      models: { FREE_PLAN: 'gemini-3.1-flash-image', PRO_PLAN: 'gemini-3.1-flash-image', ENTERPRISE_PLAN: 'gemini-3.1-flash-image' }
    },
    {
      code: 'PAPER_FIGURE_METADATA_INFER',
      displayName: 'Figure Metadata Inference',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 12,
      description: 'Infer concise figure metadata from generated visuals for captions and downstream drafting workflows.',
      tokenLimits: { maxTokensIn: 16000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gpt-4o-mini', PRO_PLAN: 'gpt-4o-mini', ENTERPRISE_PLAN: 'gpt-4o-mini' }
    },
    {
      code: 'PAPER_MANUSCRIPT_REVIEW',
      displayName: 'Grant Draft Review',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 13,
      description: 'Run a structured grant-draft review across sections, claims, evidence, and figure references.',
      tokenLimits: { maxTokensIn: 96000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gpt-5.2', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY',
      displayName: 'Grant Review Context Summary',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 14,
      description: 'Extract compact neighboring-section summaries so grant review can stay focused without losing context.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gpt-5.2', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'PAPER_MANUSCRIPT_IMPROVE',
      displayName: 'Grant Draft Improvement',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 15,
      description: 'Apply accepted review fixes to improve the grant draft with high edit fidelity.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gpt-5.2', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'PAPER_EXPORT_EXTRACTION',
      displayName: 'Formatting Profile Extraction',
      featureCode: 'GRANT_DRAFTING',
      sortOrder: 16,
      description: 'Extract structured formatting and submission-profile settings from templates, examples, or guidelines.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gpt-5.2', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2' }
    },

    {
      code: 'GRANT_REVIEWER_CONTEXT_SUMMARY',
      displayName: 'Context Summary Generator',
      featureCode: 'GRANT_REVIEWER',
      sortOrder: 1,
      description: 'Generate compact LLM-consumable summaries for mapped grant reviewer sections.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 8000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gemini-2.5-flash' }
    },
    {
      code: 'GRANT_REVIEWER_FULL_REVIEW',
      displayName: 'Full Review',
      featureCode: 'GRANT_REVIEWER',
      sortOrder: 2,
      description: 'Generate the full grant reviewer evaluation from mapped sections, template rules, and manual rubric context.',
      tokenLimits: { maxTokensIn: 96000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gemini-2.5-pro', PRO_PLAN: 'gemini-2.5-pro', ENTERPRISE_PLAN: 'gemini-2.5-pro' }
    },
    {
      code: 'GRANT_REVIEWER_FINAL_REPORT',
      displayName: 'Final Panel Report',
      featureCode: 'GRANT_REVIEWER',
      sortOrder: 3,
      description: 'Compile the final panel report and revision comparisons from completed section reviews.',
      tokenLimits: { maxTokensIn: 96000, maxTokensOut: 16000 },
      models: { FREE_PLAN: 'gpt-5.2', PRO_PLAN: 'gpt-5.2', ENTERPRISE_PLAN: 'gpt-5.2' }
    },
    {
      code: 'GRANT_REVIEWER_LANDSCAPE_DISTILL',
      displayName: 'Landscape Search Distillation',
      featureCode: 'GRANT_REVIEWER',
      sortOrder: 4,
      description: 'Distill a proposal into search facets and queries for the prior-work landscape scan.',
      tokenLimits: { maxTokensIn: 32000, maxTokensOut: 2000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gemini-2.5-flash' }
    },
    {
      code: 'GRANT_REVIEWER_LANDSCAPE_FACET_MAP',
      displayName: 'Landscape Facet Mapping',
      featureCode: 'GRANT_REVIEWER',
      sortOrder: 5,
      description: 'Tag retrieved funded projects and patents with the proposal facets they touch.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 6000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gemini-2.5-flash' }
    },
    {
      code: 'GRANT_REVIEWER_NOVELTY',
      displayName: 'Novelty & Positioning Verdict',
      featureCode: 'GRANT_REVIEWER',
      sortOrder: 6,
      description: 'Evidence-bounded novelty verdict positioning the proposal against the retrieved landscape.',
      tokenLimits: { maxTokensIn: 64000, maxTokensOut: 4000 },
      models: { FREE_PLAN: 'gemini-2.5-flash', PRO_PLAN: 'gemini-2.5-flash', ENTERPRISE_PLAN: 'gemini-2.5-flash' }
    }
  ];

  const stageSeedByCode = Object.fromEntries(stageSeeds.map(stage => [stage.code, stage]));
  for (const task of FUNDING_TASK_SEEDS) {
    if (!stageSeedByCode[task.defaultStageCode]) {
      throw new Error(`Funding task ${task.code} points to missing workflow stage ${task.defaultStageCode}`);
    }
  }

  try {
    const fundingFeature = await prisma.feature.upsert({
      where: { code: FUNDING_FEATURE_DEF.code },
      update: {
        name: FUNDING_FEATURE_DEF.name,
        unit: FUNDING_FEATURE_DEF.unit
      },
      create: FUNDING_FEATURE_DEF
    });

    for (const task of FUNDING_TASK_SEEDS) {
      await prisma.task.upsert({
        where: { code: task.code },
        update: {
          name: task.name,
          linkedFeatureId: fundingFeature.id
        },
        create: {
          code: task.code,
          name: task.name,
          linkedFeatureId: fundingFeature.id
        }
      });
    }

    console.log(`  - Funding feature/task bindings ready (${FUNDING_TASK_SEEDS.length} tasks)`);
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  [warn] Feature/Task tables do not exist yet. Skipping funding task binding seeding.');
    } else {
      throw error;
    }
  }

  const stages = stageSeeds.map(({ tokenLimits, models, ...stage }) => ({
    ...stage,
    isActive: true
  }));
  const activeStageCodes = stages.map(stage => stage.code);

  try {
    for (const stage of stages) {
      await prisma.workflowStage.upsert({
        where: { code: stage.code },
        update: stage,
        create: stage
      });
      console.log(`  - ${stage.displayName} (${stage.featureCode})`);
    }

    const retiredStages = await prisma.workflowStage.findMany({
      where: {
        code: { notIn: activeStageCodes }
      },
      select: {
        id: true,
        code: true
      }
    });

    if (retiredStages.length > 0) {
      const retiredStageIds = retiredStages.map(stage => stage.id);
      const deletedConfigs = await prisma.planStageModelConfig.deleteMany({
        where: {
          stageId: { in: retiredStageIds }
        }
      });
      const retiredUpdate = await prisma.workflowStage.updateMany({
        where: {
          id: { in: retiredStageIds }
        },
        data: {
          isActive: false
        }
      });
      console.log(`  - Retired ${retiredUpdate.count} obsolete stages and removed ${deletedConfigs.count} stage-model configs`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  [warn] WorkflowStage table does not exist yet. Skipping stage seeding.');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  // ============================================================================
  // STEP 3: Seed PRODUCTION TOKEN LIMITS for all plans
  // ============================================================================
  console.log('\n[seed] Step 3: Seeding plan stage-model defaults...\n');

  // Get all plans
  const plans = await prisma.plan.findMany();

  if (plans.length === 0) {
    console.log('  [warn] No plans found. Run seed-production-plans.js first.');
    await prisma.$disconnect();
    return;
  }

  const modelClassesByCode = {};
  try {
    for (const modelClass of MODEL_CLASS_SEEDS) {
      const record = await prisma.lLMModelClass.upsert({
        where: { code: modelClass.code },
        update: { name: modelClass.name },
        create: modelClass
      });
      modelClassesByCode[modelClass.code] = record;
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  [warn] LLMModelClass table does not exist yet. Skipping model class seeding.');
    } else {
      throw error;
    }
  }

  // Get model IDs
  const modelsByCode = {};
  const allModels = await prisma.lLMModel.findMany();
  allModels.forEach(m => { modelsByCode[m.code] = m.id; });

  // Get stage IDs
  const stagesByCode = {};
  const allStages = await prisma.workflowStage.findMany({
    where: {
      code: { in: activeStageCodes }
    }
  });
  allStages.forEach(s => { stagesByCode[s.code] = s.id; });

  // ============================================================================
  // PRODUCTION TOKEN LIMITS - GENEROUS LIMITS TO PREVENT FAILURES
  // These limits are set high to ensure LLM requests don't fail due to token limits
  // ============================================================================
  const MIN_STAGE_MAX_TOKENS_IN = 12000;
  const MIN_STAGE_MAX_TOKENS_OUT = 8000;
  const EMBEDDING_STAGE_CODES = new Set([
    'FUNDING_CHAT_EMBEDDING',
    'FUNDING_DOCUMENT_RETRIEVAL',
    'FUNDING_DOCUMENT_CHUNK_EMBEDDING'
  ]);
  const tokenLimits = Object.fromEntries(
    stageSeeds.map(stage => [stage.code, stage.tokenLimits])
  );

  // ============================================================================
  // MODEL ASSIGNMENTS PER PLAN
  // Keep a consistent grant-stage catalog while varying model quality by plan tier.
  // ============================================================================
  const planConfigs = ['FREE_PLAN', 'PRO_PLAN', 'ENTERPRISE_PLAN'].reduce((acc, planCode) => {
    acc[planCode] = Object.fromEntries(
      stageSeeds.map(stage => [stage.code, stage.models[planCode]])
    );
    return acc;
  }, {});

  try {
    for (const plan of plans) {
      const config = planConfigs[plan.code];
      if (!config) {
        console.log(`  [warn] Skipping ${plan.code} (no default config defined)`);
        continue;
      }

      console.log(`  - Configuring ${plan.code}...`);
      let configuredCount = 0;
      let taskConfiguredCount = 0;
      let accessConfiguredCount = 0;
      
      for (const [stageCode, modelCode] of Object.entries(config)) {
        const stageId = stagesByCode[stageCode];
        const modelId = modelsByCode[modelCode];
        const rawLimits = tokenLimits[stageCode];
        const limits = rawLimits
          ? {
              maxTokensIn: Math.max(rawLimits.maxTokensIn, MIN_STAGE_MAX_TOKENS_IN),
              maxTokensOut: Math.max(rawLimits.maxTokensOut, MIN_STAGE_MAX_TOKENS_OUT),
            }
          : null;
        
        if (!stageId) {
          console.log(`    [warn] Stage ${stageCode} not found, skipping`);
          continue;
        }
        if (!modelId) {
          console.log(`    [warn] Model ${modelCode} not found, skipping`);
          continue;
        }

        await prisma.planStageModelConfig.upsert({
          where: {
            planId_stageId: {
              planId: plan.id,
              stageId: stageId
            }
          },
          update: {
            modelId: modelId,
            maxTokensIn: limits ? limits.maxTokensIn : null,
            maxTokensOut: limits ? limits.maxTokensOut : null,
            isActive: true
          },
          create: {
            planId: plan.id,
            stageId: stageId,
            modelId: modelId,
            maxTokensIn: limits ? limits.maxTokensIn : null,
            maxTokensOut: limits ? limits.maxTokensOut : null,
            isActive: true
          }
        });
        configuredCount++;
      }

      const fundingAccess = FUNDING_TASK_ACCESS_BY_PLAN[plan.code];
      for (const task of FUNDING_TASK_SEEDS) {
        const defaultStage = stageSeedByCode[task.defaultStageCode];
        const modelCode = defaultStage.models[plan.code];
        const modelId = modelsByCode[modelCode];
        const rawLimits = tokenLimits[task.defaultStageCode];
        const limits = rawLimits
          ? {
              maxTokensIn: Math.max(rawLimits.maxTokensIn, MIN_STAGE_MAX_TOKENS_IN),
              maxTokensOut: EMBEDDING_STAGE_CODES.has(task.defaultStageCode)
                ? 0
                : Math.max(rawLimits.maxTokensOut, MIN_STAGE_MAX_TOKENS_OUT),
            }
          : null;

        if (!modelId) {
          console.log(`    [warn] Model ${modelCode} not found for task ${task.code}, skipping task default`);
          continue;
        }

        await prisma.planTaskModelConfig.upsert({
          where: {
            planId_taskCode: {
              planId: plan.id,
              taskCode: task.code
            }
          },
          update: {
            modelId,
            maxTokensIn: limits ? limits.maxTokensIn : null,
            maxTokensOut: limits ? limits.maxTokensOut : null,
            isActive: true
          },
          create: {
            planId: plan.id,
            taskCode: task.code,
            modelId,
            maxTokensIn: limits ? limits.maxTokensIn : null,
            maxTokensOut: limits ? limits.maxTokensOut : null,
            isActive: true
          }
        });
        taskConfiguredCount++;

        const defaultClass = fundingAccess ? modelClassesByCode[fundingAccess.defaultClass] : null;
        if (fundingAccess && defaultClass) {
          await prisma.planLLMAccess.upsert({
            where: {
              planId_taskCode: {
                planId: plan.id,
                taskCode: task.code
              }
            },
            update: {
              allowedClasses: JSON.stringify(fundingAccess.allowedClasses),
              defaultClassId: defaultClass.id
            },
            create: {
              planId: plan.id,
              taskCode: task.code,
              allowedClasses: JSON.stringify(fundingAccess.allowedClasses),
              defaultClassId: defaultClass.id
            }
          });
          accessConfiguredCount++;
        }
      }

      console.log(
        `  - ${plan.code} configured (${configuredCount} stages, ${taskConfiguredCount} funding task defaults, ${accessConfiguredCount} funding access rules)`
      );
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  [warn] PlanStageModelConfig table does not exist yet.');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  console.log('\n[done] LLM model and workflow stage seeding complete.');
  console.log(`   - ${models.length} LLM models registered`);
  console.log(`   - ${stages.length} workflow stages`);
  console.log(`   - ${FUNDING_TASK_SEEDS.length} funding task defaults aligned to current stages`);
  console.log(`   - ${plans.length} plans configured with PRODUCTION token limits`);
}

main()
  .catch((e) => {
    console.error('[error] Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
