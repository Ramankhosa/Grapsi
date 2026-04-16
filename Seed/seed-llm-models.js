#!/usr/bin/env node

/**
 * ============================================================================
 * SEED: LLM Models and Workflow Stages - PRODUCTION CONFIG
 * ============================================================================
 *
 * Seeds the database with:
 * 1. All available LLM models (Google, OpenAI, Anthropic, DeepSeek, Groq, Zhipu, Qwen)
 * 2. All workflow stages (Patent Drafting, Novelty Search, etc.)
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

async function main() {
  console.log('🚀 Seeding LLM Models and Workflow Stages (PRODUCTION CONFIG)...\n');

  // ============================================================================
  // STEP 1: Seed all available LLM models
  // ============================================================================
  console.log('📦 Step 1: Seeding LLM Models Registry...\n');

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
    // Provider supports: claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus, claude-3-sonnet, claude-3-haiku
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

    // === ZHIPU MODELS (GLM) ===
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
      code: 'glm-4.5v',
      displayName: 'GLM-4.5V',
      provider: 'zhipu',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 60,     // $0.60
      outputCostPer1M: 180,   // $1.80
      isActive: true,
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
      console.log(`  ✅ ${model.displayName} (${model.provider})`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  ⚠️  LLMModel table does not exist yet. Skipping LLM models seeding.');
      console.log('  💡 Run migrations first: npx prisma migrate deploy');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  // ============================================================================
  // STEP 2: Seed workflow stages
  // ============================================================================
  console.log('\n📋 Step 2: Seeding Workflow Stages...\n');

  const stages = [
    // === PATENT DRAFTING STAGES (LLM-Powered) ===
    { code: 'DRAFT_IDEA_ENTRY', displayName: 'Idea Entry & Normalization', featureCode: 'PATENT_DRAFTING', sortOrder: 1, description: 'Initial idea input and AI-based normalization' },
    { code: 'DRAFT_CLAIM_GENERATION', displayName: 'Initial Claims Generation', featureCode: 'PATENT_DRAFTING', sortOrder: 2, description: 'Generate initial patent claims from idea' },
    { code: 'DRAFT_PRIOR_ART_ANALYSIS', displayName: 'Prior Art Analysis', featureCode: 'PATENT_DRAFTING', sortOrder: 3, description: 'Analyze prior art relevance' },
    { code: 'DRAFT_CLAIM_REFINEMENT', displayName: 'Claim Refinement', featureCode: 'PATENT_DRAFTING', sortOrder: 4, description: 'Refine claims based on prior art' },
    { code: 'DRAFT_FIGURE_PLANNER', displayName: 'Figure Planning', featureCode: 'PATENT_DRAFTING', sortOrder: 5, description: 'AI-powered figure planning and diagram suggestions' },
    { code: 'DRAFT_SKETCH_GENERATION', displayName: 'Sketch Generation', featureCode: 'PATENT_DRAFTING', sortOrder: 6, description: 'Generate patent sketches using Gemini 3 Pro Image Preview' },
    { code: 'DRAFT_DIAGRAM_GENERATION', displayName: 'Diagram Generation', featureCode: 'PATENT_DRAFTING', sortOrder: 7, description: 'Generate PlantUML/technical diagrams' },

    // === ANNEXURE/SECTION DRAFTING STAGES ===
    { code: 'DRAFT_ANNEXURE_TITLE', displayName: 'Title Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 8, description: 'Draft patent title (superset: title)' },
    { code: 'DRAFT_ANNEXURE_PREAMBLE', displayName: 'Preamble Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 9, description: 'Draft legal preamble (superset: preamble)' },
    { code: 'DRAFT_ANNEXURE_FIELD', displayName: 'Field of Invention', featureCode: 'PATENT_DRAFTING', sortOrder: 10, description: 'Draft field of invention section (superset: fieldOfInvention)' },
    { code: 'DRAFT_ANNEXURE_BACKGROUND', displayName: 'Background Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 11, description: 'Draft background section (superset: background)' },
    { code: 'DRAFT_ANNEXURE_OBJECTS', displayName: 'Objects of Invention', featureCode: 'PATENT_DRAFTING', sortOrder: 12, description: 'Draft objects of invention (superset: objectsOfInvention)' },
    { code: 'DRAFT_ANNEXURE_SUMMARY', displayName: 'Summary Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 13, description: 'Draft invention summary (superset: summary)' },
    { code: 'DRAFT_ANNEXURE_TECHNICAL_PROBLEM', displayName: 'Technical Problem', featureCode: 'PATENT_DRAFTING', sortOrder: 14, description: 'Draft technical problem statement (superset: technicalProblem)' },
    { code: 'DRAFT_ANNEXURE_TECHNICAL_SOLUTION', displayName: 'Technical Solution', featureCode: 'PATENT_DRAFTING', sortOrder: 15, description: 'Draft technical solution (superset: technicalSolution)' },
    { code: 'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS', displayName: 'Advantageous Effects', featureCode: 'PATENT_DRAFTING', sortOrder: 16, description: 'Draft advantageous effects (superset: advantageousEffects)' },
    { code: 'DRAFT_ANNEXURE_DRAWINGS', displayName: 'Brief Description of Drawings', featureCode: 'PATENT_DRAFTING', sortOrder: 17, description: 'Draft brief description of drawings (superset: briefDescriptionOfDrawings)' },
    { code: 'DRAFT_REFERENCE_DRAFT_PASS1', displayName: 'Reference Draft Pass 1', featureCode: 'PATENT_DRAFTING', sortOrder: 18, description: 'Generate country-neutral reference draft before jurisdiction adaptation' },
    { code: 'DRAFT_ANNEXURE_DESCRIPTION', displayName: 'Reference Draft Pass 2 / Detailed Description', featureCode: 'PATENT_DRAFTING', sortOrder: 19, description: 'Apply jurisdiction-specific top-up/translation and support detailed description generation' },
    { code: 'DRAFT_ANNEXURE_BEST_MODE', displayName: 'Best Mode', featureCode: 'PATENT_DRAFTING', sortOrder: 20, description: 'Draft best mode description (superset: bestMethod)' },
    { code: 'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY', displayName: 'Industrial Applicability', featureCode: 'PATENT_DRAFTING', sortOrder: 21, description: 'Draft industrial applicability (superset: industrialApplicability)' },
    { code: 'DRAFT_ANNEXURE_CLAIMS', displayName: 'Claims Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 22, description: 'Draft final patent claims (superset: claims)' },
    { code: 'DRAFT_ANNEXURE_ABSTRACT', displayName: 'Abstract Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 23, description: 'Draft patent abstract (superset: abstract)' },
    { code: 'DRAFT_ANNEXURE_NUMERALS', displayName: 'List of Reference Numerals', featureCode: 'PATENT_DRAFTING', sortOrder: 24, description: 'Draft list of reference numerals (superset: listOfNumerals)' },
    { code: 'DRAFT_ANNEXURE_CROSS_REFERENCE', displayName: 'Cross-Reference to Related Applications', featureCode: 'PATENT_DRAFTING', sortOrder: 25, description: 'Draft cross-reference section (superset: crossReference)' },
    { code: 'DRAFT_REVIEW', displayName: 'AI Review & Fix', featureCode: 'PATENT_DRAFTING', sortOrder: 26, description: 'AI-powered patent review' },

    // === NOVELTY SEARCH STAGES ===
    { code: 'NOVELTY_QUERY_GENERATION', displayName: 'Query Generation', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 1, description: 'Generate search queries from idea' },
    { code: 'NOVELTY_PATENT_SEARCH', displayName: 'Patent Search', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 2, description: 'Search patent databases' },
    { code: 'NOVELTY_RELEVANCE_SCORING', displayName: 'Relevance Scoring', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 3, description: 'Score patent relevance' },
    { code: 'NOVELTY_FEATURE_ANALYSIS', displayName: 'Feature Analysis', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 4, description: 'Analyze feature overlap' },
    { code: 'NOVELTY_COMPARISON', displayName: 'Detailed Comparison', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 5, description: 'Compare with prior art' },
    { code: 'NOVELTY_REPORT_GENERATION', displayName: 'Report Generation', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 6, description: 'Generate novelty report' },

    // === IDEA BANK STAGES ===
    { code: 'IDEA_BANK_GENERATION', displayName: 'Idea Generation', featureCode: 'IDEA_BANK', sortOrder: 1, description: 'Generate white-space patent ideas from prior art analysis' },
    { code: 'IDEA_BANK_NORMALIZE', displayName: 'Idea Normalization', featureCode: 'IDEA_BANK', sortOrder: 2, description: 'Normalize and structure idea' },
    { code: 'IDEA_BANK_SEARCH', displayName: 'Similar Ideas Search', featureCode: 'IDEA_BANK', sortOrder: 3, description: 'Search for similar ideas' },

    // === DIAGRAM GENERATION STAGES ===
    { code: 'DIAGRAM_PLANTUML', displayName: 'PlantUML Generation', featureCode: 'DIAGRAM_GENERATION', sortOrder: 1, description: 'Generate PlantUML code' },
    { code: 'DIAGRAM_FLOWCHART', displayName: 'Flowchart Generation', featureCode: 'DIAGRAM_GENERATION', sortOrder: 2, description: 'Generate flowcharts' },
    { code: 'DIAGRAM_SEQUENCE', displayName: 'Sequence Diagram', featureCode: 'DIAGRAM_GENERATION', sortOrder: 3, description: 'Generate sequence diagrams' },
    { code: 'DIAGRAM_BLOCK', displayName: 'Block Diagram', featureCode: 'DIAGRAM_GENERATION', sortOrder: 4, description: 'Generate block diagrams' },

    // === PAPER WRITING ASSISTANT STAGES ===
    { code: 'PAPER_CREATE_SECTIONS', displayName: 'Create Sections from Selected Text', featureCode: 'PAPER_DRAFTING', sortOrder: 1, description: 'Reorganize selected plain text into headed sections with coherent body paragraphs' },
    { code: 'PAPER_FIGURE_SUGGESTION', displayName: 'Figure Suggestions', featureCode: 'PAPER_DRAFTING', sortOrder: 2, description: 'Suggest publication-quality figures aligned to section rhetoric and available evidence' },
    { code: 'PAPER_CHART_GENERATOR', displayName: 'Chart Generator', featureCode: 'PAPER_DRAFTING', sortOrder: 3, description: 'Generate chart configurations for paper figures' },
    { code: 'PAPER_DIAGRAM_GENERATOR', displayName: 'Diagram Generator', featureCode: 'PAPER_DRAFTING', sortOrder: 4, description: 'Generate Mermaid/PlantUML diagrams for paper figures' },
    { code: 'PAPER_DIAGRAM_FROM_TEXT', displayName: 'Diagram From Text', featureCode: 'PAPER_DRAFTING', sortOrder: 5, description: 'Create a diagram directly from selected paper text' },
    { code: 'PAPER_SKETCH_GENERATION', displayName: 'Paper Sketch Generation', featureCode: 'PAPER_DRAFTING', sortOrder: 6, description: 'Generate scientific figure sketches/images' },
    { code: 'PAPER_FIGURE_METADATA_INFER', displayName: 'Paper Figure Metadata Inference', featureCode: 'PAPER_DRAFTING', sortOrder: 7, description: 'Infer concise metadata from generated figure images using a low-cost vision model' },
    { code: 'PAPER_MANUSCRIPT_REVIEW', displayName: 'Paper Manuscript Review', featureCode: 'PAPER_DRAFTING', sortOrder: 8, description: 'Run a structured manuscript audit across sections, evidence, citations, and figure references' },
    { code: 'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY', displayName: 'Paper Review Context Summary', featureCode: 'PAPER_DRAFTING', sortOrder: 9, description: 'Extract compact structured summaries of neighboring sections for section-by-section review' },
    { code: 'PAPER_MANUSCRIPT_IMPROVE', displayName: 'Paper Manuscript Improve', featureCode: 'PAPER_DRAFTING', sortOrder: 10, description: 'Apply approved review recommendations to improve the manuscript section by section' },
    { code: 'PAPER_EXPORT_EXTRACTION', displayName: 'Paper Export Extraction', featureCode: 'PAPER_DRAFTING', sortOrder: 11, description: 'Extract adaptive export settings from DOCX, LaTeX, or pasted formatting guidelines' },

    // === IDEATION ENGINE STAGES (Mind-Map Patent Ideation) ===
    { code: 'IDEATION_NORMALIZE', displayName: 'Seed Normalization', featureCode: 'IDEATION', sortOrder: 1, description: 'Extracts structured information from the seed input (core entity, goal, constraints, unknowns, contradictions)' },
    { code: 'IDEATION_CLASSIFY', displayName: 'Invention Classification', featureCode: 'IDEATION', sortOrder: 2, description: 'Classifies the invention into categories (Product/Method/System/etc.) with multi-label support' },
    { code: 'IDEATION_CONTRADICTION_MAPPING', displayName: 'Contradiction Mapping (Stage 2.5)', featureCode: 'IDEATION', sortOrder: 3, description: 'Maps technical contradictions to TRIZ inventive principles and resolution strategies' },
    { code: 'IDEATION_EXPAND', displayName: 'Dimension Expansion', featureCode: 'IDEATION', sortOrder: 4, description: 'Expands dimension nodes with specific options based on the invention context' },
    { code: 'IDEATION_OBVIOUSNESS_FILTER', displayName: 'Obviousness Filter (Stage 3.5)', featureCode: 'IDEATION', sortOrder: 5, description: 'Scores selected dimensions for novelty before generation, suggests wildcards for obvious combinations' },
    { code: 'IDEATION_GENERATE', displayName: 'Idea Frame Generation', featureCode: 'IDEATION', sortOrder: 6, description: 'Generates structured invention ideas (IdeaFrames) from selected components, dimensions, and operators with inventive logic' },
    { code: 'IDEATION_NOVELTY', displayName: 'Novelty Assessment', featureCode: 'IDEATION', sortOrder: 7, description: 'Analyzes search results to assess novelty, provides mutation instructions for weak ideas' }
  ];

  try {
    for (const stage of stages) {
      await prisma.workflowStage.upsert({
        where: { code: stage.code },
        update: stage,
        create: stage
      });
      console.log(`  ✅ ${stage.displayName} (${stage.featureCode})`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  ⚠️  WorkflowStage table does not exist yet. Skipping stages seeding.');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  // ============================================================================
  // STEP 3: Seed PRODUCTION TOKEN LIMITS for all plans
  // ============================================================================
  console.log('\n⚙️ Step 3: Seeding Production Token Limits for All Plans...\n');

  // Get all plans
  const plans = await prisma.plan.findMany();

  if (plans.length === 0) {
    console.log('  ⚠️  No plans found. Run seed-production-plans.js first.');
    await prisma.$disconnect();
    return;
  }

  // Get model IDs
  const modelsByCode = {};
  const allModels = await prisma.lLMModel.findMany();
  allModels.forEach(m => { modelsByCode[m.code] = m.id; });

  // Get stage IDs
  const stagesByCode = {};
  const allStages = await prisma.workflowStage.findMany();
  allStages.forEach(s => { stagesByCode[s.code] = s.id; });

  // ============================================================================
  // PRODUCTION TOKEN LIMITS - GENEROUS LIMITS TO PREVENT FAILURES
  // These limits are set high to ensure LLM requests don't fail due to token limits
  // ============================================================================
  const MIN_STAGE_MAX_TOKENS_IN = 12000;
  const MIN_STAGE_MAX_TOKENS_OUT = 8000;
  const tokenLimits = {
    // Core drafting stages - HIGH LIMITS for complex generation
    'DRAFT_IDEA_ENTRY':                   { maxTokensIn: 20000,  maxTokensOut: 16000 },
    'DRAFT_CLAIM_GENERATION':             { maxTokensIn: 30000,  maxTokensOut: 16000 },
    'DRAFT_PRIOR_ART_ANALYSIS':           { maxTokensIn: 50000,  maxTokensOut: 16000 },
    'DRAFT_CLAIM_REFINEMENT':             { maxTokensIn: 30000,  maxTokensOut: 16000 },
    'DRAFT_FIGURE_PLANNER':               { maxTokensIn: 30000,  maxTokensOut: 16000 },
    'DRAFT_SKETCH_GENERATION':            { maxTokensIn: 20000,  maxTokensOut: 8192 },
    'DRAFT_DIAGRAM_GENERATION':           { maxTokensIn: 30000,  maxTokensOut: 16000 },
    // Annexure/Section stages - GENEROUS LIMITS for patent sections
    'DRAFT_ANNEXURE_TITLE':               { maxTokensIn: 20000,  maxTokensOut: 2000 },
    'DRAFT_ANNEXURE_PREAMBLE':            { maxTokensIn: 20000,  maxTokensOut: 4000 },
    'DRAFT_ANNEXURE_FIELD':               { maxTokensIn: 20000,  maxTokensOut: 4000 },
    'DRAFT_ANNEXURE_BACKGROUND':          { maxTokensIn: 40000,  maxTokensOut: 16000 },
    'DRAFT_ANNEXURE_OBJECTS':             { maxTokensIn: 20000,  maxTokensOut: 8000 },
    'DRAFT_ANNEXURE_SUMMARY':             { maxTokensIn: 40000,  maxTokensOut: 16000 },
    'DRAFT_ANNEXURE_TECHNICAL_PROBLEM':   { maxTokensIn: 30000,  maxTokensOut: 10000 },
    'DRAFT_ANNEXURE_TECHNICAL_SOLUTION':  { maxTokensIn: 30000,  maxTokensOut: 10000 },
    'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS':{ maxTokensIn: 30000,  maxTokensOut: 10000 },
    'DRAFT_ANNEXURE_DRAWINGS':            { maxTokensIn: 30000,  maxTokensOut: 10000 },
    'DRAFT_REFERENCE_DRAFT_PASS1':        { maxTokensIn: 60000,  maxTokensOut: 16000 },
    'DRAFT_ANNEXURE_DESCRIPTION':         { maxTokensIn: 60000,  maxTokensOut: 16000 },  // Largest section
    'DRAFT_ANNEXURE_BEST_MODE':           { maxTokensIn: 30000,  maxTokensOut: 10000 },
    'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': { maxTokensIn: 20000, maxTokensOut: 8000 },
    'DRAFT_ANNEXURE_CLAIMS':              { maxTokensIn: 40000,  maxTokensOut: 16000 },  // Critical section
    'DRAFT_ANNEXURE_ABSTRACT':            { maxTokensIn: 30000,  maxTokensOut: 8000 },
    'DRAFT_ANNEXURE_NUMERALS':            { maxTokensIn: 20000,  maxTokensOut: 8000 },
    'DRAFT_ANNEXURE_CROSS_REFERENCE':     { maxTokensIn: 30000,  maxTokensOut: 10000 },
    'DRAFT_REVIEW':                       { maxTokensIn: 100000, maxTokensOut: 16000 },  // Needs full patent context
    // Novelty search stages - HIGH LIMITS for analysis
    'NOVELTY_QUERY_GENERATION':           { maxTokensIn: 20000,  maxTokensOut: 8000 },
    'NOVELTY_RELEVANCE_SCORING':          { maxTokensIn: 40000,  maxTokensOut: 8000 },
    'NOVELTY_FEATURE_ANALYSIS':           { maxTokensIn: 60000,  maxTokensOut: 16000 },
    'NOVELTY_COMPARISON':                 { maxTokensIn: 80000,  maxTokensOut: 16000 },
    'NOVELTY_REPORT_GENERATION':          { maxTokensIn: 100000, maxTokensOut: 16000 },  // Comprehensive report
    // Idea bank stages
    'IDEA_BANK_GENERATION':               { maxTokensIn: 40000,  maxTokensOut: 16000 },
    'IDEA_BANK_NORMALIZE':                { maxTokensIn: 20000,  maxTokensOut: 8000 },
    'IDEA_BANK_SEARCH':                   { maxTokensIn: 20000,  maxTokensOut: 8000 },
    // Diagram stages
    'DIAGRAM_PLANTUML':                   { maxTokensIn: 30000,  maxTokensOut: 8000 },
    'DIAGRAM_FLOWCHART':                  { maxTokensIn: 30000,  maxTokensOut: 8000 },
    'DIAGRAM_SEQUENCE':                   { maxTokensIn: 30000,  maxTokensOut: 8000 },
    'DIAGRAM_BLOCK':                      { maxTokensIn: 30000,  maxTokensOut: 8000 },
    // Paper assistant stages
    'PAPER_CREATE_SECTIONS':              { maxTokensIn: 24000,  maxTokensOut: 12000 },
    'PAPER_FIGURE_SUGGESTION':            { maxTokensIn: 48000,  maxTokensOut: 12000 },
    'PAPER_CHART_GENERATOR':              { maxTokensIn: 32000,  maxTokensOut: 8000 },
    'PAPER_DIAGRAM_GENERATOR':            { maxTokensIn: 48000,  maxTokensOut: 12000 },
    'PAPER_DIAGRAM_FROM_TEXT':            { maxTokensIn: 48000,  maxTokensOut: 12000 },
    'PAPER_SKETCH_GENERATION':            { maxTokensIn: 32000,  maxTokensOut: 12000 },
    'PAPER_FIGURE_METADATA_INFER':        { maxTokensIn: 16000,  maxTokensOut: 4000 },
    'PAPER_MANUSCRIPT_REVIEW':            { maxTokensIn: 96000,  maxTokensOut: 16000 },
    'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY': { maxTokensIn: 32000,  maxTokensOut: 4000 },
    'PAPER_MANUSCRIPT_IMPROVE':           { maxTokensIn: 64000,  maxTokensOut: 16000 },
    'PAPER_EXPORT_EXTRACTION':            { maxTokensIn: 32000,  maxTokensOut: 8000 },
    // IDEATION stages (Mind-Map Patent Ideation Engine) - GENEROUS for creative work
    'IDEATION_NORMALIZE':                 { maxTokensIn: 20000,  maxTokensOut: 8192 },
    'IDEATION_CLASSIFY':                  { maxTokensIn: 20000,  maxTokensOut: 8192 },
    'IDEATION_CONTRADICTION_MAPPING':     { maxTokensIn: 30000,  maxTokensOut: 8192 },
    'IDEATION_EXPAND':                    { maxTokensIn: 30000,  maxTokensOut: 8192 },
    'IDEATION_OBVIOUSNESS_FILTER':        { maxTokensIn: 30000,  maxTokensOut: 8192 },
    'IDEATION_GENERATE':                  { maxTokensIn: 40000,  maxTokensOut: 16000 },  // Heavy generation
    'IDEATION_NOVELTY':                   { maxTokensIn: 50000,  maxTokensOut: 16000 },  // Complex analysis
  };

  // ============================================================================
  // MODEL ASSIGNMENTS PER PLAN (KEEP EXISTING - DO NOT COPY FROM ENTERPRISE)
  // Token limits are now PRODUCTION values, but models remain per-tier
  // ============================================================================
  const planConfigs = {
    // =========================================================================
    // FREE_PLAN - Cost-effective: Gemini 2.5 Flash Lite, 2.5 Pro for major sections
    // =========================================================================
    'FREE_PLAN': {
      // Core drafting stages
      'DRAFT_IDEA_ENTRY':                   'gemini-2.5-flash-lite',
      'DRAFT_CLAIM_GENERATION':             'gemini-2.5-flash-lite',
      'DRAFT_PRIOR_ART_ANALYSIS':           'gemini-2.5-pro',         // Major: use Pro
      'DRAFT_CLAIM_REFINEMENT':             'gemini-2.5-flash-lite',
      'DRAFT_FIGURE_PLANNER':               'gemini-2.5-flash-lite',
      'DRAFT_SKETCH_GENERATION':            'gemini-3-pro-image-preview',  // Nano Banana Pro
      'DRAFT_DIAGRAM_GENERATION':           'gemini-2.5-flash-lite',
      // Annexure/Section stages
      'DRAFT_ANNEXURE_TITLE':               'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_PREAMBLE':            'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_FIELD':               'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_BACKGROUND':          'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_OBJECTS':             'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_SUMMARY':             'gemini-2.5-pro',         // Major: use Pro
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM':   'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION':  'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS':'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_DRAWINGS':            'gemini-2.5-flash-lite',
      'DRAFT_REFERENCE_DRAFT_PASS1':        'claude-opus-4.5',
      'DRAFT_ANNEXURE_DESCRIPTION':         'gemini-2.5-pro',         // Major: use Pro
      'DRAFT_ANNEXURE_BEST_MODE':           'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_CLAIMS':              'gemini-2.5-pro',         // Major: use Pro
      'DRAFT_ANNEXURE_ABSTRACT':            'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_NUMERALS':            'gemini-2.5-flash-lite',
      'DRAFT_ANNEXURE_CROSS_REFERENCE':     'gemini-2.5-flash-lite',
      'DRAFT_REVIEW':                       'gemini-2.5-pro',         // Major: use Pro
      // Novelty search stages
      'NOVELTY_QUERY_GENERATION':           'gemini-2.5-flash-lite',
      'NOVELTY_RELEVANCE_SCORING':          'gemini-2.5-flash-lite',
      'NOVELTY_FEATURE_ANALYSIS':           'gemini-2.5-flash-lite',
      'NOVELTY_COMPARISON':                 'gemini-2.5-flash-lite',
      'NOVELTY_REPORT_GENERATION':          'gemini-2.5-pro',         // Major: use Pro
      // Idea bank stages
      'IDEA_BANK_GENERATION':               'gemini-2.5-pro',         // Creative: use Pro
      'IDEA_BANK_NORMALIZE':                'gemini-2.5-flash-lite',
      'IDEA_BANK_SEARCH':                   'gemini-2.5-flash-lite',
      // Diagram stages
      'DIAGRAM_PLANTUML':                   'gemini-2.5-flash-lite',
      'DIAGRAM_FLOWCHART':                  'gemini-2.5-flash-lite',
      'DIAGRAM_SEQUENCE':                   'gemini-2.5-flash-lite',
      'DIAGRAM_BLOCK':                      'gemini-2.5-flash-lite',
      // Paper assistant stages
      'PAPER_CREATE_SECTIONS':              'gemini-2.5-flash',
      'PAPER_FIGURE_SUGGESTION':            'gemini-2.5-pro',
      'PAPER_CHART_GENERATOR':              'gpt-4o',
      'PAPER_DIAGRAM_GENERATOR':            'gpt-4o',
      'PAPER_DIAGRAM_FROM_TEXT':            'gpt-4o',
      'PAPER_SKETCH_GENERATION':            'gemini-3.1-flash-image',
      'PAPER_FIGURE_METADATA_INFER':        'gpt-4o-mini',
      'PAPER_MANUSCRIPT_REVIEW':            'gpt-5.2',
      'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY': 'gpt-5.2',
      'PAPER_MANUSCRIPT_IMPROVE':           'gpt-5.2',
      'PAPER_EXPORT_EXTRACTION':            'gpt-5.2',
      // IDEATION stages - Use Pro for heavy reasoning, Flash Lite for lighter tasks
      'IDEATION_NORMALIZE':                 'gemini-2.5-flash-lite',
      'IDEATION_CLASSIFY':                  'gemini-2.5-flash-lite',
      'IDEATION_CONTRADICTION_MAPPING':     'gemini-2.5-pro',         // Complex TRIZ reasoning
      'IDEATION_EXPAND':                    'gemini-2.5-flash-lite',
      'IDEATION_OBVIOUSNESS_FILTER':        'gemini-2.5-pro',         // Novelty assessment
      'IDEATION_GENERATE':                  'gemini-2.5-pro',         // Creative idea generation
      'IDEATION_NOVELTY':                   'gemini-2.5-pro',         // Complex analysis
    },

    // =========================================================================
    // PRO_PLAN - Balanced: Mix of Gemini 2.5 Pro and GPT-5 models
    // =========================================================================
    'PRO_PLAN': {
      // Core drafting stages
      'DRAFT_IDEA_ENTRY':                   'gemini-2.5-pro',
      'DRAFT_CLAIM_GENERATION':             'gpt-5-mini',
      'DRAFT_PRIOR_ART_ANALYSIS':           'gemini-2.5-pro',
      'DRAFT_CLAIM_REFINEMENT':             'gpt-5-mini',
      'DRAFT_FIGURE_PLANNER':               'gemini-2.5-pro',
      'DRAFT_SKETCH_GENERATION':            'gemini-3-pro-image-preview',  // Nano Banana Pro
      'DRAFT_DIAGRAM_GENERATION':           'gpt-4o',
      // Annexure/Section stages
      'DRAFT_ANNEXURE_TITLE':               'gpt-5-mini',
      'DRAFT_ANNEXURE_PREAMBLE':            'gemini-2.5-pro',
      'DRAFT_ANNEXURE_FIELD':               'gemini-2.5-pro',
      'DRAFT_ANNEXURE_BACKGROUND':          'gemini-2.5-pro',
      'DRAFT_ANNEXURE_OBJECTS':             'gpt-5-mini',
      'DRAFT_ANNEXURE_SUMMARY':             'gpt-5',
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM':   'gpt-5-mini',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION':  'gpt-5-mini',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS':'gemini-2.5-pro',
      'DRAFT_ANNEXURE_DRAWINGS':            'gemini-2.5-pro',
      'DRAFT_REFERENCE_DRAFT_PASS1':        'claude-opus-4.5',
      'DRAFT_ANNEXURE_DESCRIPTION':         'gpt-5',
      'DRAFT_ANNEXURE_BEST_MODE':           'gpt-5-mini',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gemini-2.5-pro',
      'DRAFT_ANNEXURE_CLAIMS':              'gpt-5',
      'DRAFT_ANNEXURE_ABSTRACT':            'gpt-5-mini',
      'DRAFT_ANNEXURE_NUMERALS':            'gemini-2.5-pro',
      'DRAFT_ANNEXURE_CROSS_REFERENCE':     'gemini-2.5-pro',
      'DRAFT_REVIEW':                       'gpt-5',
      // Novelty search stages
      'NOVELTY_QUERY_GENERATION':           'gpt-5-mini',
      'NOVELTY_RELEVANCE_SCORING':          'gemini-2.5-flash-lite',
      'NOVELTY_FEATURE_ANALYSIS':           'gemini-2.5-pro',
      'NOVELTY_COMPARISON':                 'gpt-5-mini',
      'NOVELTY_REPORT_GENERATION':          'gpt-5',
      // Idea bank stages
      'IDEA_BANK_GENERATION':               'gpt-5',
      'IDEA_BANK_NORMALIZE':                'gpt-5-mini',
      'IDEA_BANK_SEARCH':                   'gemini-2.5-pro',
      // Diagram stages
      'DIAGRAM_PLANTUML':                   'gpt-4o',
      'DIAGRAM_FLOWCHART':                  'gpt-4o',
      'DIAGRAM_SEQUENCE':                   'gpt-4o',
      'DIAGRAM_BLOCK':                      'gpt-4o',
      // Paper assistant stages
      'PAPER_CREATE_SECTIONS':              'gpt-5.2',
      'PAPER_FIGURE_SUGGESTION':            'gpt-5.2',
      'PAPER_CHART_GENERATOR':              'gemini-2.5-pro',
      'PAPER_DIAGRAM_GENERATOR':            'gpt-5.2',
      'PAPER_DIAGRAM_FROM_TEXT':            'gpt-5.2',
      'PAPER_SKETCH_GENERATION':            'gemini-3.1-flash-image',
      'PAPER_FIGURE_METADATA_INFER':        'gpt-4o-mini',
      'PAPER_MANUSCRIPT_REVIEW':            'gpt-5.2',
      'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY': 'gpt-5.2',
      'PAPER_MANUSCRIPT_IMPROVE':           'gpt-5.2',
      'PAPER_EXPORT_EXTRACTION':            'gpt-5.2',
      // IDEATION stages - Pro tier: GPT-5 for creative, Gemini Pro for analysis
      'IDEATION_NORMALIZE':                 'gemini-2.5-pro',
      'IDEATION_CLASSIFY':                  'gemini-2.5-pro',
      'IDEATION_CONTRADICTION_MAPPING':     'gpt-5',                  // Complex TRIZ reasoning
      'IDEATION_EXPAND':                    'gemini-2.5-pro',
      'IDEATION_OBVIOUSNESS_FILTER':        'gpt-5',                  // Novelty assessment
      'IDEATION_GENERATE':                  'gpt-5',                  // Creative idea generation
      'IDEATION_NOVELTY':                   'gpt-5',                  // Complex analysis
    },

    // =========================================================================
    // ENTERPRISE_PLAN - Premium: GPT-5 series (as provided by user)
    // =========================================================================
    'ENTERPRISE_PLAN': {
      // Core drafting stages
      'DRAFT_IDEA_ENTRY':                   'gpt-5-mini',
      'DRAFT_CLAIM_GENERATION':             'gpt-5',
      'DRAFT_PRIOR_ART_ANALYSIS':           'gemini-2.5-pro',
      'DRAFT_CLAIM_REFINEMENT':             'gpt-5',
      'DRAFT_FIGURE_PLANNER':               'gemini-2.5-pro',
      'DRAFT_SKETCH_GENERATION':            'gemini-3-pro-image-preview',  // Nano Banana Pro
      'DRAFT_DIAGRAM_GENERATION':           'gpt-4o',
      // Annexure/Section stages
      'DRAFT_ANNEXURE_TITLE':               'gpt-5-mini',
      'DRAFT_ANNEXURE_PREAMBLE':            'gpt-5-mini',
      'DRAFT_ANNEXURE_FIELD':               'gpt-5-mini',
      'DRAFT_ANNEXURE_BACKGROUND':          'gpt-5-mini',
      'DRAFT_ANNEXURE_OBJECTS':             'gpt-5-mini',
      'DRAFT_ANNEXURE_SUMMARY':             'gpt-5',
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM':   'gpt-5',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION':  'gpt-5',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS':'gpt-5-mini',
      'DRAFT_ANNEXURE_DRAWINGS':            'gpt-5-mini',
      'DRAFT_REFERENCE_DRAFT_PASS1':        'claude-opus-4.5',
      'DRAFT_ANNEXURE_DESCRIPTION':         'gpt-5',
      'DRAFT_ANNEXURE_BEST_MODE':           'gpt-5-mini',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gpt-5-mini',
      'DRAFT_ANNEXURE_CLAIMS':              'gpt-5',
      'DRAFT_ANNEXURE_ABSTRACT':            'gpt-5-mini',
      'DRAFT_ANNEXURE_NUMERALS':            'gpt-5-nano',
      'DRAFT_ANNEXURE_CROSS_REFERENCE':     'gpt-5-nano',
      'DRAFT_REVIEW':                       'gpt-5.1',
      // Novelty search stages
      'NOVELTY_QUERY_GENERATION':           'gpt-5-mini',
      'NOVELTY_RELEVANCE_SCORING':          'gpt-5-nano',
      'NOVELTY_FEATURE_ANALYSIS':           'gpt-5',
      'NOVELTY_COMPARISON':                 'gpt-5',
      'NOVELTY_REPORT_GENERATION':          'gpt-5',
      // Idea bank stages
      'IDEA_BANK_GENERATION':               'gpt-5',
      'IDEA_BANK_NORMALIZE':                'gpt-5-mini',
      'IDEA_BANK_SEARCH':                   'gpt-5-nano',
      // Diagram stages
      'DIAGRAM_PLANTUML':                   'gpt-4o',
      'DIAGRAM_FLOWCHART':                  'gpt-4o',
      'DIAGRAM_SEQUENCE':                   'gpt-4o',
      'DIAGRAM_BLOCK':                      'gpt-4o',
      // Paper assistant stages
      'PAPER_CREATE_SECTIONS':              'gpt-5',
      'PAPER_FIGURE_SUGGESTION':            'gpt-5.2-thinking',
      'PAPER_CHART_GENERATOR':              'gpt-5.2',
      'PAPER_DIAGRAM_GENERATOR':            'gpt-5.2-thinking',
      'PAPER_DIAGRAM_FROM_TEXT':            'gpt-5.2-thinking',
      'PAPER_SKETCH_GENERATION':            'gemini-3.1-flash-image',
      'PAPER_FIGURE_METADATA_INFER':        'gpt-4o-mini',
      'PAPER_MANUSCRIPT_REVIEW':            'gpt-5.2',
      'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY': 'gpt-5.2',
      'PAPER_MANUSCRIPT_IMPROVE':           'gpt-5.2',
      'PAPER_EXPORT_EXTRACTION':            'gpt-5.2',
      // IDEATION stages - Enterprise tier: Best models for maximum quality
      'IDEATION_NORMALIZE':                 'gpt-5-mini',
      'IDEATION_CLASSIFY':                  'gpt-5-mini',
      'IDEATION_CONTRADICTION_MAPPING':     'gpt-5.1',                // Complex TRIZ reasoning - best model
      'IDEATION_EXPAND':                    'gpt-5-mini',
      'IDEATION_OBVIOUSNESS_FILTER':        'gpt-5',                  // Novelty assessment
      'IDEATION_GENERATE':                  'gpt-5.1',                // Creative idea generation - best model
      'IDEATION_NOVELTY':                   'gpt-5.1',                // Complex analysis - best model
    }
  };

  try {
    for (const plan of plans) {
      const config = planConfigs[plan.code];
      if (!config) {
        console.log(`  ⏭️ Skipping ${plan.code} (no default config defined)`);
        continue;
      }

      console.log(`  📝 Configuring ${plan.code}...`);
      let configuredCount = 0;
      
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
          console.log(`    ⚠️ Stage ${stageCode} not found, skipping`);
          continue;
        }
        if (!modelId) {
          console.log(`    ⚠️ Model ${modelCode} not found, skipping`);
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
      console.log(`  ✅ ${plan.code} configured (${configuredCount} stages)`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  ⚠️  PlanStageModelConfig table does not exist yet.');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  console.log('\n✨ PRODUCTION LLM Models & Workflow Stages seeding complete!');
  console.log(`   - ${models.length} LLM models (new models unassigned)`);
  console.log(`   - ${stages.length} workflow stages`);
  console.log(`   - ${plans.length} plans configured with PRODUCTION token limits`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
