// Standardized error handling for the metering system

export const METERING_ERRORS = {
  // Identity & Resolution Errors
  TENANT_UNRESOLVED: 'TENANT_UNRESOLVED',
  PLAN_EXPIRED: 'PLAN_EXPIRED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  INVALID_ATI_TOKEN: 'INVALID_ATI_TOKEN',

  // Access Control Errors
  FEATURE_UNAVAILABLE: 'FEATURE_UNAVAILABLE',
  FEATURE_NOT_FOUND: 'FEATURE_NOT_FOUND',
  TASK_UNAVAILABLE: 'TASK_UNAVAILABLE',
  MODEL_CLASS_UNAVAILABLE: 'MODEL_CLASS_UNAVAILABLE',
  INVALID_MODEL: 'INVALID_MODEL',
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE',

  // Quota & Limit Errors
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  DAILY_QUOTA_EXCEEDED: 'DAILY_QUOTA_EXCEEDED',
  MONTHLY_QUOTA_EXCEEDED: 'MONTHLY_QUOTA_EXCEEDED',
  CONCURRENCY_LIMIT: 'CONCURRENCY_LIMIT',

  // Reservation Errors
  RESERVATION_FAILED: 'RESERVATION_FAILED',
  RESERVATION_NOT_FOUND: 'RESERVATION_NOT_FOUND',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  DUPLICATE_RESERVATION: 'DUPLICATE_RESERVATION',

  // Policy Errors
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  INVALID_POLICY_CONFIG: 'INVALID_POLICY_CONFIG',

  // System Errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const

export type MeteringErrorCode = keyof typeof METERING_ERRORS

// HTTP status code mappings
export const ERROR_STATUS_MAP: Record<MeteringErrorCode, number> = {
  TENANT_UNRESOLVED: 401,
  PLAN_EXPIRED: 403,
  TENANT_SUSPENDED: 403,
  INVALID_ATI_TOKEN: 401,

  FEATURE_UNAVAILABLE: 403,
  FEATURE_NOT_FOUND: 500,
  TASK_UNAVAILABLE: 403,
  MODEL_CLASS_UNAVAILABLE: 403,
  INVALID_MODEL: 400,
  INPUT_TOO_LARGE: 413,

  QUOTA_EXCEEDED: 429,
  DAILY_QUOTA_EXCEEDED: 429,
  MONTHLY_QUOTA_EXCEEDED: 429,
  CONCURRENCY_LIMIT: 429,

  RESERVATION_FAILED: 500,
  RESERVATION_NOT_FOUND: 404,
  RESERVATION_EXPIRED: 410,
  DUPLICATE_RESERVATION: 409,

  POLICY_VIOLATION: 403,
  INVALID_POLICY_CONFIG: 500,

  DATABASE_ERROR: 500,
  CONFIGURATION_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
}

/**
 * Custom error class for metering operations
 */
export class MeteringError extends Error {
  public readonly code: MeteringErrorCode
  public readonly statusCode: number
  public readonly isRetryable: boolean
  public readonly details?: Record<string, any>

  constructor(
    code: MeteringErrorCode,
    message?: string,
    details?: Record<string, any>
  ) {
    super(message || METERING_ERRORS[code])
    this.name = 'MeteringError'
    this.code = code
    this.statusCode = ERROR_STATUS_MAP[code]
    this.isRetryable = this.determineRetryability(code)
    this.details = details
  }

  private determineRetryability(code: MeteringErrorCode): boolean {
    // Retryable errors are typically temporary issues
    const retryableCodes: MeteringErrorCode[] = [
      'DATABASE_ERROR',
      'SERVICE_UNAVAILABLE',
      'RESERVATION_FAILED', // Might succeed on retry with different key
    ]

    return retryableCodes.includes(code)
  }

  /**
   * Create a JSON representation for API responses
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.isRetryable,
    }
  }

  /**
   * Create user-friendly error messages
   */
  getUserMessage(): string {
    switch (this.code) {
      case 'QUOTA_EXCEEDED':
        return 'You have exceeded your usage limit. Please upgrade your plan or try again later.'

      case 'DAILY_QUOTA_EXCEEDED':
        return 'You have reached your daily usage limit. Please try again tomorrow.'

      case 'MONTHLY_QUOTA_EXCEEDED':
        return 'You have reached your monthly usage limit. Please upgrade your plan.'

      case 'CONCURRENCY_LIMIT':
        return 'Too many requests at once. Please wait a moment and try again.'

      case 'FEATURE_UNAVAILABLE':
        return 'This feature is not available on your current plan. Please upgrade to access it.'

      case 'TENANT_SUSPENDED':
        return 'Your account has been suspended. Please contact support.'

      case 'PLAN_EXPIRED':
        return 'Your plan has expired. Please renew your subscription.'

      default:
        return 'An error occurred. Please try again or contact support if the problem persists.'
    }
  }

  /**
   * Get retry-after header value in seconds
   */
  getRetryAfter(): number | null {
    switch (this.code) {
      case 'CONCURRENCY_LIMIT':
        return 5 // 5 seconds
      case 'QUOTA_EXCEEDED':
      case 'DAILY_QUOTA_EXCEEDED':
        return 3600 // 1 hour
      case 'MONTHLY_QUOTA_EXCEEDED':
        return 86400 // 24 hours
      default:
        return null
    }
  }
}

/**
 * Utility functions for error handling
 */
export class MeteringErrorUtils {
  /**
   * Wrap unknown errors into MeteringError
   */
  static wrap(error: unknown, defaultCode: MeteringErrorCode = 'SERVICE_UNAVAILABLE'): MeteringError {
    if (error instanceof MeteringError) {
      return error
    }

    if (error instanceof Error) {
      return new MeteringError(defaultCode, error.message)
    }

    return new MeteringError(defaultCode, 'An unknown error occurred')
  }

  /**
   * Check if an error is retryable
   */
  static isRetryable(error: unknown): boolean {
    return error instanceof MeteringError && error.isRetryable
  }

  /**
   * Create specific error types with helpers
   */
  static tenantNotFound(tenantId?: string): MeteringError {
    return new MeteringError('TENANT_UNRESOLVED', 'Tenant not found', { tenantId })
  }

  static planExpired(planId: string): MeteringError {
    return new MeteringError('PLAN_EXPIRED', 'Plan has expired', { planId })
  }

  static quotaExceeded(feature: string, limit: number, current: number): MeteringError {
    return new MeteringError('QUOTA_EXCEEDED', `Quota exceeded for ${feature}`, {
      feature,
      limit,
      current,
      remaining: Math.max(0, limit - current)
    })
  }

  static concurrencyLimit(limit: number): MeteringError {
    return new MeteringError('CONCURRENCY_LIMIT', `Maximum ${limit} concurrent requests allowed`)
  }

  static featureUnavailable(feature: string, plan: string): MeteringError {
    return new MeteringError('FEATURE_UNAVAILABLE', `Feature ${feature} not available on plan ${plan}`, {
      feature,
      plan
    })
  }
}
