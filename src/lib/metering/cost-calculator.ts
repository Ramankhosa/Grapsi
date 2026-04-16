/**
 * LLM Cost Calculator
 * Calculates actual costs and contingency-adjusted costs for LLM operations
 * 
 * PRICING SOURCE PRIORITY:
 * 1. LLMModel table (llm-config) - inputCostPer1M/outputCostPer1M in CENTS per 1M tokens
 * 2. LLMModelPrice table (model-costs) - inputPricePerMTokens/outputPricePerMTokens in USD per 1M tokens  
 * 3. Fallback to hardcoded defaults (only if DB not loaded)
 * 
 * All internal calculations use per-token costs in USD
 */

import { prisma } from '@/lib/prisma'

// Default pricing fallback for unknown models (conservative $1/$4 per M)
interface ModelPricing {
  input: number
  output: number
  thoughtTokenCost?: number
}

const DEFAULT_PRICING: ModelPricing = {
  input: 0.000001,
  output: 0.000004,
  thoughtTokenCost: 0.000004
}

// Contingency multiplier (10%)
export const CONTINGENCY_MULTIPLIER = 1.10

// USD to INR conversion rate
export const USD_TO_INR = 95

// Cache for database-loaded pricing (per-token costs in USD)
let dbPricingCache: Map<string, ModelPricing> | null = null
let dbPricingLoadedAt: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes cache

/**
 * Load pricing from database tables
 * Priority: LLMModel (llm-config) > LLMModelPrice (model-costs)
 */
async function loadDatabasePricing(): Promise<Map<string, ModelPricing>> {
  const priceMap = new Map<string, ModelPricing>()
  
  try {
    // First, load from LLMModel table (primary source, configured in llm-config)
    // These are stored in CENTS per 1M tokens
    const llmModels = await prisma.lLMModel.findMany({
      where: { isActive: true },
      select: {
        code: true,
        inputCostPer1M: true,
        outputCostPer1M: true
      }
    })
    
    for (const model of llmModels) {
      if (model.inputCostPer1M > 0 || model.outputCostPer1M > 0) {
        // Convert from cents per 1M to USD per token
        // cents per 1M → USD per 1M → USD per token
        // e.g., 250 cents = $2.50 per 1M = $0.0000025 per token
        priceMap.set(model.code, {
          input: (model.inputCostPer1M / 100) / 1_000_000,
          output: (model.outputCostPer1M / 100) / 1_000_000
        })
      }
    }
    
    // Then, load from LLMModelPrice table (secondary source, configured in model-costs)
    // These are stored in USD per 1M tokens
    // Only add models not already in the map (LLMModel takes priority)
    const modelPrices = await prisma.lLMModelPrice.findMany({
      select: {
        modelClass: true,
        inputPricePerMTokens: true,
        outputPricePerMTokens: true
      }
    })
    
    for (const price of modelPrices) {
      if (!priceMap.has(price.modelClass)) {
        // Convert from USD per 1M to USD per token
        priceMap.set(price.modelClass, {
          input: price.inputPricePerMTokens / 1_000_000,
          output: price.outputPricePerMTokens / 1_000_000
        })
      }
    }
    
    console.log(`[CostCalculator] Loaded ${priceMap.size} model prices from database`)
    
  } catch (error) {
    console.warn('[CostCalculator] Failed to load pricing from database:', error)
    // Return empty map - will use fallback pricing
  }
  
  return priceMap
}

/**
 * Get cached or fresh database pricing
 */
async function getDatabasePricing(): Promise<Map<string, ModelPricing>> {
  const now = Date.now()
  
  // Check if cache is still valid
  if (dbPricingCache && (now - dbPricingLoadedAt) < CACHE_TTL_MS) {
    return dbPricingCache
  }
  
  // Load fresh pricing
  dbPricingCache = await loadDatabasePricing()
  dbPricingLoadedAt = now
  
  return dbPricingCache
}

/**
 * Force refresh of pricing cache
 */
export async function refreshPricingCache(): Promise<void> {
  dbPricingCache = await loadDatabasePricing()
  dbPricingLoadedAt = Date.now()
}

/**
 * Ensure pricing is loaded (call this on app startup for immediate accuracy)
 * Returns true if pricing was loaded from database, false if using defaults
 */
export async function ensurePricingLoaded(): Promise<boolean> {
  const pricing = await getDatabasePricing()
  return pricing.size > 0
}

/**
 * Check if database pricing is loaded
 */
export function isPricingLoaded(): boolean {
  return dbPricingCache !== null && dbPricingCache.size > 0
}

/**
 * Calculate LLM operation cost with detailed breakdown
 */
export interface CostBreakdown {
  // Token counts
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  totalTokens: number
  
  // Cost components in USD
  inputCost: number
  outputCost: number
  thoughtCost: number
  actualCost: number
  contingencyCost: number  // 10% added for contingency
  
  // Model info
  modelCode: string
  provider: string
  
  // Per-million rates for display
  inputPricePerMillion: number
  outputPricePerMillion: number
  thoughtPricePerMillion: number
}

function canonicalizeModelCode(modelCode: string): string {
  return modelCode.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getPricingLookupCandidates(modelCode: string): string[] {
  const trimmedCode = modelCode.trim()
  if (!trimmedCode) return []

  const candidates = new Set<string>([trimmedCode, trimmedCode.toLowerCase()])

  // Route/model aliases commonly suffix "-thinking", while pricing is stored for base model code.
  if (trimmedCode.toLowerCase().endsWith('-thinking')) {
    const baseCode = trimmedCode.slice(0, -'-thinking'.length)
    if (baseCode) {
      candidates.add(baseCode)
      candidates.add(baseCode.toLowerCase())
    }
  }

  return Array.from(candidates)
}

function applyThoughtTokenFallback(pricing: ModelPricing): ModelPricing {
  return {
    ...pricing,
    thoughtTokenCost: pricing.thoughtTokenCost ?? pricing.output
  }
}

/**
 * Get pricing for a model from cache (sync version for use in calculateCost)
 * Falls back to default pricing if model not found in cache
 */
export function getModelPricingSync(modelCode: string): ModelPricing {
  // Check database cache first
  if (dbPricingCache) {
    const lookupCandidates = getPricingLookupCandidates(modelCode)

    // Exact lookup (including base alias candidates).
    for (const candidate of lookupCandidates) {
      const dbPrice = dbPricingCache.get(candidate)
      if (dbPrice) {
        return applyThoughtTokenFallback(dbPrice)
      }
    }
    
    // Case-insensitive lookup.
    for (const [code, price] of Array.from(dbPricingCache.entries())) {
      if (lookupCandidates.includes(code.toLowerCase())) {
        return applyThoughtTokenFallback(price)
      }
    }

    // Canonicalized lookup handles punctuation variants like 3.5 vs 3-5.
    const canonicalCandidates = new Set(lookupCandidates.map(canonicalizeModelCode))
    for (const [code, price] of Array.from(dbPricingCache.entries())) {
      if (canonicalCandidates.has(canonicalizeModelCode(code))) {
        return applyThoughtTokenFallback(price)
      }
    }
  }
  
  // Return default pricing - model not configured
  console.warn(`[CostCalculator] Model not found in database: ${modelCode}, using default pricing ($1/$4 per 1M)`)
  return applyThoughtTokenFallback(DEFAULT_PRICING)
}

/**
 * Get pricing for a model (async version that ensures cache is loaded)
 */
export async function getModelPricing(modelCode: string): Promise<ModelPricing> {
  // Ensure cache is loaded
  await getDatabasePricing()
  return getModelPricingSync(modelCode)
}

/**
 * Get provider name from model code
 */
export function getProviderFromModel(modelCode: string): string {
  const lowerCode = modelCode.toLowerCase()
  
  if (lowerCode.startsWith('gpt-') || lowerCode.startsWith('o1')) return 'OpenAI'
  if (lowerCode.includes('claude')) return 'Anthropic'
  if (lowerCode.includes('gemini') || lowerCode.includes('gemini-')) return 'Google'
  if (lowerCode.includes('deepseek')) return 'DeepSeek'
  if (lowerCode.startsWith('glm')) return 'Zhipu'
  if (lowerCode.startsWith('qwen')) return 'Qwen'
  if (lowerCode.includes('llama') || lowerCode.includes('mixtral') || lowerCode.includes('gemma') || lowerCode.startsWith('groq-')) return 'Groq'
  
  return 'Unknown'
}

/**
 * Calculate complete cost breakdown for an LLM operation
 * Uses cached database pricing (call ensurePricingLoaded() on app startup for accuracy)
 */
export function calculateCost(
  modelCode: string,
  inputTokens: number,
  outputTokens: number,
  thoughtTokens?: number
): CostBreakdown {
  const pricing = getModelPricingSync(modelCode)
  const provider = getProviderFromModel(modelCode)

  const normalizedInputTokens = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.floor(inputTokens) : 0
  const normalizedOutputTokens = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.floor(outputTokens) : 0
  const rawThoughtTokens = typeof thoughtTokens === 'number' ? thoughtTokens : 0
  const normalizedThoughtTokens = Number.isFinite(rawThoughtTokens) && rawThoughtTokens > 0
    ? Math.floor(rawThoughtTokens)
    : 0
  
  // Calculate individual costs
  const inputCost = normalizedInputTokens * pricing.input
  const outputCost = normalizedOutputTokens * pricing.output
  const thoughtTokenCost = pricing.thoughtTokenCost ?? pricing.output
  const thoughtCost = normalizedThoughtTokens * thoughtTokenCost
  
  // Total actual cost
  const actualCost = inputCost + outputCost + thoughtCost
  
  // Contingency cost (10% increase)
  const contingencyCost = actualCost * CONTINGENCY_MULTIPLIER
  
  return {
    // Token counts
    inputTokens: normalizedInputTokens,
    outputTokens: normalizedOutputTokens,
    thoughtTokens: normalizedThoughtTokens,
    totalTokens: normalizedInputTokens + normalizedOutputTokens + normalizedThoughtTokens,
    
    // Costs
    inputCost,
    outputCost,
    thoughtCost,
    actualCost,
    contingencyCost,
    
    // Model info
    modelCode,
    provider,
    
    // Per-million rates
    inputPricePerMillion: pricing.input * 1_000_000,
    outputPricePerMillion: pricing.output * 1_000_000,
    thoughtPricePerMillion: thoughtTokenCost * 1_000_000,
  }
}

/**
 * Format cost for display (e.g., "$0.0012" or "$0.00")
 */
export function formatCost(cost: number, decimals: number = 6): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(decimals)}`
  }
  return `$${cost.toFixed(4)}`
}

/**
 * Generate detailed console log message for LLM operation cost
 */
export function generateCostLogMessage(
  operationType: string,
  costBreakdown: CostBreakdown,
  metadata?: {
    taskCode?: string
    stageCode?: string
    patentId?: string
    paperId?: string
    userId?: string
    tenantId?: string
    duration?: number
    module?: string
    action?: string
    resolvedModelCode?: string
    providerModel?: string
  }
): string {
  const divider = '═'.repeat(70)
  const thinDivider = '─'.repeat(70)
  
  // Determine module label for the header
  const moduleLabel = metadata?.module === 'publication_ideation' 
    ? '📝 PAPER WRITING' 
    : metadata?.module === 'patent_drafting'
    ? '📜 PATENT DRAFTING'
    : '🤖 LLM'
  
  let message = `\n${divider}\n`
  message += `💰 ${moduleLabel} COST REPORT: ${operationType}\n`
  message += `${thinDivider}\n`
  
  // Model & Provider Info
  const providerModel = typeof metadata?.providerModel === 'string' ? metadata.providerModel.trim() : ''
  const displayModel = providerModel || costBreakdown.modelCode
  message += `📊 MODEL: ${displayModel} (${costBreakdown.provider})\n`

  if (
    metadata?.resolvedModelCode &&
    metadata.resolvedModelCode.trim() &&
    metadata.resolvedModelCode !== displayModel
  ) {
    message += `🧭 CONFIGURED MODEL: ${metadata.resolvedModelCode}\n`
  }
  
  if (metadata?.taskCode) {
    message += `🎯 Task: ${metadata.taskCode}`
    if (metadata.stageCode) message += ` | Stage: ${metadata.stageCode}`
    message += '\n'
  }
  
  // Show action for paper writing operations
  if (metadata?.action) {
    message += `📋 Action: ${metadata.action}\n`
  }
  
  // Show relevant document ID
  if (metadata?.paperId) {
    message += `📄 Paper: ${metadata.paperId}\n`
  } else if (metadata?.patentId) {
    message += `📄 Patent: ${metadata.patentId}\n`
  }
  
  message += `${thinDivider}\n`
  
  // Token Breakdown
  message += `📥 PROMPT TOKENS:  ${costBreakdown.inputTokens.toLocaleString().padStart(10)} × $${(costBreakdown.inputPricePerMillion).toFixed(2)}/M = ${formatCost(costBreakdown.inputCost)}\n`
  message += `🧠 THOUGHT TOKENS: ${costBreakdown.thoughtTokens.toLocaleString().padStart(10)} × $${(costBreakdown.thoughtPricePerMillion).toFixed(2)}/M = ${formatCost(costBreakdown.thoughtCost)}\n`
  message += `📤 OUTPUT TOKENS:  ${costBreakdown.outputTokens.toLocaleString().padStart(10)} × $${(costBreakdown.outputPricePerMillion).toFixed(2)}/M = ${formatCost(costBreakdown.outputCost)}\n`
  
  message += `📊 TOTAL TOKENS:   ${costBreakdown.totalTokens.toLocaleString().padStart(10)}\n`
  message += `${thinDivider}\n`
  
  // Cost Summary (USD)
  message += `💵 ACTUAL COST:      ${formatCost(costBreakdown.actualCost).padStart(15)}\n`
  message += `💵 WITH 10% BUFFER:  ${formatCost(costBreakdown.contingencyCost).padStart(15)} ← Use for billing\n`
  message += `${thinDivider}\n`
  
  // Cost Summary (INR)
  const actualCostINR = costBreakdown.actualCost * USD_TO_INR
  const contingencyCostINR = costBreakdown.contingencyCost * USD_TO_INR
  message += `🇮🇳 ACTUAL COST (INR):     ₹${actualCostINR.toFixed(4).padStart(10)}\n`
  message += `🇮🇳 WITH BUFFER (INR):     ₹${contingencyCostINR.toFixed(4).padStart(10)} ← Use for billing\n`
  
  if (metadata?.duration) {
    message += `⏱️  DURATION:         ${(metadata.duration / 1000).toFixed(2)}s\n`
  }
  
  message += `${divider}\n`
  
  return message
}

/**
 * Quick log function for LLM operations - outputs to console
 */
export function logLLMCost(
  operationType: string,
  modelCode: string,
  inputTokens: number,
  outputTokens: number,
  thoughtTokens?: number,
  metadata?: {
    taskCode?: string
    stageCode?: string
    patentId?: string
    paperId?: string
    userId?: string
    tenantId?: string
    duration?: number
    module?: string
    action?: string
    resolvedModelCode?: string
    providerModel?: string
  }
): CostBreakdown {
  const costBreakdown = calculateCost(modelCode, inputTokens, outputTokens, thoughtTokens)
  const logMessage = generateCostLogMessage(operationType, costBreakdown, metadata)
  console.log(logMessage)
  return costBreakdown
}

