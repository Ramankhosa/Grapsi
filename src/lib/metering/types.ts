// Core types and interfaces for the metering system

import type {
  PlanStatus,
  FeatureCode,
  TaskCode,
  ModelClass,
  TenantStatus
} from '@/lib/prisma-generated'

// === CONTEXT TYPES ===

export interface TenantContext {
  tenantId: string
  planId: string
  userId?: string
  tenantStatus?: TenantStatus
}

export interface RequestMetadata {
  userId?: string
  ip?: string
  userAgent?: string
  correlationId?: string
  idempotencyKey?: string
  stageCode?: string
}

// === FEATURE REQUEST TYPES ===

export interface FeatureRequest {
  tenantId: string
  featureCode: FeatureCode
  taskCode?: TaskCode
  userId?: string
  metadata?: RequestMetadata
}

// === LLM REQUEST/RESPONSE TYPES ===

// Image content for multimodal LLMs
export interface ImageContent {
  mimeType: string // e.g., "image/jpeg", "image/png"
  data: string // base64 encoded image data
  description?: string // optional description of the image
}

// File content for document-capable multimodal models
export interface FileContent {
  mimeType?: string // e.g., "application/pdf"
  data?: string // base64 encoded file data
  url?: string // public URL for provider-side fetch
  filename?: string
}

// Multimodal content types
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: ImageContent }
  | { type: 'file'; file: FileContent }

export interface MultimodalContent {
  parts: ContentPart[]
}

export interface LLMRequest {
  taskCode: TaskCode
  prompt?: string
  content?: MultimodalContent // For multimodal requests (text + images)
  inputTokens?: number
  modelClass?: string
  parameters?: Record<string, any>
  idempotencyKey?: string
  metadata?: Record<string, any>
  stream?: LLMStreamOptions
}

export interface LLMResponse {
  output: string
  outputTokens: number
  modelClass: string
  metadata?: Record<string, any>
}

export interface LLMStreamToken {
  delta: string
  output: string
  modelClass?: string
  provider?: string
  model?: string
}

export interface LLMStreamOptions {
  onToken?: (token: LLMStreamToken) => void | Promise<void>
}

// === ENFORCEMENT DECISION TYPES ===

export interface EnforcementDecision {
  allowed: boolean
  modelClass?: ModelClass
  maxTokensIn?: number
  maxTokensOut?: number
  maxSteps?: number
  topK?: number
  maxFiles?: number
  concurrencyLimit?: number
  reservationId?: string
  reason?: string
  retryAfter?: number
  remainingQuota?: {
    daily?: number
    monthly?: number
  }
}

// === USAGE TRACKING TYPES ===

export interface UsageStats {
  inputTokens?: number
  outputTokens?: number
  apiCalls?: number
  modelClass?: ModelClass
  apiCode?: string // PATENT_OPEN, NPL_OPEN, etc.
  metadata?: Record<string, any>
}

export interface MeteringContext {
  tenantId: string
  featureCode?: FeatureCode
  taskCode?: TaskCode
  userId?: string
  idempotencyKey: string
  metadata?: RequestMetadata
}

// === POLICY TYPES ===

export interface PolicyLimits {
  maxTokensIn?: number
  maxTokensOut?: number
  agentMaxSteps?: number
  retrievalTopK?: number
  diagramFilesPerReq?: number
  concurrencyLimit?: number
}

export interface PlanDetails {
  id: string
  code: string
  name: string
  status: PlanStatus
  features: FeatureDetails[]
  llmAccess: TaskLLMAccess[]
  policyLimits: PolicyLimits
}

export interface FeatureDetails {
  code: FeatureCode
  name: string
  unit: string
  monthlyQuota?: number
  dailyQuota?: number
}

export interface TaskLLMAccess {
  taskCode: TaskCode
  allowedClasses: ModelClass[]
  defaultClass: ModelClass
}

// === METERING RESULTS ===

export interface MeteringResult {
  success: boolean
  reservationId?: string
  usageCommitted?: boolean
   error?: any
}

export interface QuotaCheckResult {
  allowed: boolean
  remaining: {
    daily?: number
    monthly?: number
  }
  resetTime?: Date
}

// === SERVICE INTERFACES ===

export interface IdentityService {
  resolveTenantContext(atiToken: string): Promise<TenantContext | null>
  validateTenantAccess(tenantId: string): Promise<boolean>
}

export interface CatalogService {
  getPlanDetails(planId: string): Promise<PlanDetails | null>
  getFeatureDetails(featureCode: FeatureCode): Promise<FeatureDetails | null>
  getTaskDetails(taskCode: TaskCode): Promise<{ code: TaskCode; name: string; linkedFeature: FeatureCode } | null>
}

export interface PolicyService {
  evaluateAccess(request: FeatureRequest): Promise<EnforcementDecision>
  getPolicyLimits(tenantId: string, taskCode?: TaskCode): Promise<PolicyLimits>
  checkQuota(request: FeatureRequest): Promise<QuotaCheckResult>
  createReservation(request: FeatureRequest, limits: PolicyLimits): Promise<string>
}

export interface ReservationService {
  createReservation(context: MeteringContext, units: number): Promise<string>
  releaseReservation(reservationId: string): Promise<void>
  getActiveReservations(tenantId: string, taskCode?: string): Promise<number>
  getConcurrencyLimit(tenantId: string, taskCode?: string, stageCode?: string): Promise<number>
}

export interface MeteringService {
  recordUsage(reservationId: string, stats: UsageStats, userId?: string): Promise<MeteringResult>
  checkQuota(request: FeatureRequest): Promise<QuotaCheckResult>
  getUsage(tenantId: string, featureCode?: FeatureCode, period?: 'daily' | 'monthly'): Promise<{
    current: number
    limit?: number
    resetTime?: Date
  }>
  updateUsageMeters(reservation: any, stats: UsageStats): Promise<void>
  checkQuotaAlerts(tenantId: string, featureId?: string, taskCode?: TaskCode): Promise<void>
  getCurrentUsage(tenantId: string, featureCode?: string, periodType?: 'DAILY' | 'MONTHLY'): Promise<number>
}

// === CONFIGURATION TYPES ===

export interface MeteringConfig {
  enabled: boolean
  allowBypassForAdmins: boolean
  defaultLimits: PolicyLimits
  reservationTimeoutMs: number
  maxConcurrentReservations: number
}

// === UTILITY TYPES ===

export type PeriodType = 'DAILY' | 'MONTHLY'
export type PeriodKey = string // Format: YYYY-MM-DD for daily, YYYY-MM for monthly

export interface PeriodInfo {
  type: PeriodType
  key: PeriodKey
  start: Date
  end: Date
}

// Re-export Prisma enums for convenience
export { PlanStatus, FeatureCode, TaskCode, ModelClass, TenantStatus }
