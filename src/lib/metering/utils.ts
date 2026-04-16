// Utility functions for the metering system

import type { PeriodType, PeriodKey, PeriodInfo } from './types'

/**
 * Generate period keys for usage tracking
 */
export function getCurrentPeriod(type: PeriodType): PeriodInfo {
  const now = new Date()

  switch (type) {
    case 'DAILY': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
      const key = start.toISOString().split('T')[0] // YYYY-MM-DD

      return {
        type,
        key,
        start,
        end,
      }
    }

    case 'MONTHLY': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` // YYYY-MM

      return {
        type,
        key,
        start,
        end,
      }
    }

    default:
      throw new Error(`Unknown period type: ${type}`)
  }
}

/**
 * Get period info for a specific date
 */
export function getPeriodForDate(date: Date, type: PeriodType): PeriodInfo {
  const originalNow = Date.now
  try {
    // Temporarily mock Date.now to return our target date
    global.Date.now = () => date.getTime()
    return getCurrentPeriod(type)
  } finally {
    global.Date.now = originalNow
  }
}

/**
 * Check if a date is within a period
 */
export function isDateInPeriod(date: Date, period: PeriodInfo): boolean {
  return date >= period.start && date <= period.end
}

/**
 * Generate idempotency keys
 */
export function generateIdempotencyKey(prefix: string = 'metering'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 15)
  return `${prefix}_${timestamp}_${random}`
}

/**
 * Safe JSON parsing with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

/**
 * Safe JSON stringification
 */
export function safeJsonStringify(obj: any): string {
  try {
    return JSON.stringify(obj)
  } catch {
    return '{}'
  }
}

/**
 * Calculate remaining quota
 */
export function calculateRemainingQuota(used: number, limit?: number): number | null {
  if (limit === undefined || limit === null) {
    return null // Unlimited
  }
  return Math.max(0, limit - used)
}

/**
 * Check if quota is exceeded
 */
export function isQuotaExceeded(used: number, limit?: number): boolean {
  if (limit === undefined || limit === null) {
    return false // Unlimited
  }
  return used >= limit
}

/**
 * Format usage for logging
 */
export function formatUsage(stats: {
  inputTokens?: number
  outputTokens?: number
  apiCalls?: number
  modelClass?: string
  apiCode?: string
}): string {
  const parts = []

  if (stats.inputTokens) parts.push(`${stats.inputTokens} in`)
  if (stats.outputTokens) parts.push(`${stats.outputTokens} out`)
  if (stats.apiCalls) parts.push(`${stats.apiCalls} calls`)
  if (stats.modelClass) parts.push(`${stats.modelClass}`)
  if (stats.apiCode) parts.push(`${stats.apiCode}`)

  return parts.join(', ') || 'no usage'
}

/**
 * Calculate tokens per second rate
 */
export function calculateRate(tokens: number, durationMs: number): number {
  if (durationMs === 0) return 0
  return (tokens / durationMs) * 1000 // tokens per second
}

/**
 * Validate feature/task codes
 */
export function isValidFeatureCode(code: string): code is import('./types').FeatureCode {
  const validCodes = [
    'PRIOR_ART_SEARCH',
    'PATENT_DRAFTING',
    'DIAGRAM_GENERATION',
  ]
  return validCodes.includes(code)
}

export function isValidTaskCode(code: string): code is import('./types').TaskCode {
  const validCodes = [
    'LLM1_PRIOR_ART',
    'LLM2_DRAFT',
    'LLM3_DIAGRAM',
    'LLM4_NOVELTY_SCREEN',
    'LLM5_NOVELTY_ASSESS',
  ]
  return validCodes.includes(code)
}

export function isValidModelClass(code: string): code is import('./types').ModelClass {
  const validCodes = [
    'BASE_S',
    'BASE_M',
    'PRO_M',
    'PRO_L',
    'ADVANCED',
  ]
  return validCodes.includes(code)
}

/**
 * Cache key generators for Redis/external caching
 */
export class CacheKeys {
  static tenantContext(tenantId: string): string {
    return `metering:tenant:${tenantId}:context`
  }

  static planDetails(planId: string): string {
    return `metering:plan:${planId}:details`
  }

  static featureQuota(tenantId: string, featureCode: string, period: PeriodKey): string {
    return `metering:quota:${tenantId}:${featureCode}:${period}`
  }

  static activeReservations(tenantId: string): string {
    return `metering:reservations:${tenantId}:active`
  }

  static policyLimits(tenantId: string, taskCode?: string): string {
    const taskPart = taskCode ? `:${taskCode}` : ''
    return `metering:policy:${tenantId}${taskPart}:limits`
  }
}

/**
 * Time utilities
 */
export class TimeUtils {
  static minutes(n: number): number {
    return n * 60 * 1000
  }

  static hours(n: number): number {
    return n * 60 * 60 * 1000
  }

  static days(n: number): number {
    return n * 24 * 60 * 60 * 1000
  }

  static addMs(date: Date, ms: number): Date {
    return new Date(date.getTime() + ms)
  }

  static isExpired(date: Date): boolean {
    return date.getTime() < Date.now()
  }
}
