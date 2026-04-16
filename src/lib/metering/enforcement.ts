// Main enforcement function (Module 5)
// Orchestrates all metering checks

import { NextResponse } from 'next/server'
import type { FeatureRequest, EnforcementDecision, MeteringResult } from './types'
import { MeteringError } from './errors'
import { createMeteringSystem } from './system'

// High-level enforcement function
export async function enforceMetering(
  request: { headers: Record<string, string> },
  featureRequest: FeatureRequest
): Promise<{ decision: EnforcementDecision; error?: MeteringError }> {
  try {
    const system = createMeteringSystem()

    // Evaluate access using policy service
    const decision = await system.policy.evaluateAccess(featureRequest)

    if (!decision.allowed) {
      return { decision }
    }

    // Create reservation if allowed
    if (decision.reservationId) {
      // Reservation already created during policy evaluation
      return { decision }
    }

    return { decision }
  } catch (error) {
    if (error instanceof MeteringError) {
      return { decision: { allowed: false, reason: error.message }, error }
    }

    const wrappedError = new MeteringError('SERVICE_UNAVAILABLE', 'Metering service unavailable')
    return { decision: { allowed: false, reason: wrappedError.message }, error: wrappedError }
  }
}

/**
 * Safe wrapper for integrating metering into existing API routes
 * - Doesn't break existing functionality if metering fails
 * - Can be gradually rolled out
 * - Provides clear error responses
 */
export async function withMetering<T>(
  request: { headers: Record<string, string> },
  featureRequest: FeatureRequest,
  operation: () => Promise<T>,
  onSuccess?: (result: T, reservationId?: string) => Promise<void>
): Promise<{ success: boolean; data?: T; error?: NextResponse }> {
  try {
    // Attempt metering check
    const meteringResult = await enforceMetering(request, featureRequest)

    if (meteringResult.error) {
      // Return structured error response that doesn't break existing API contract
      const errorResponse = NextResponse.json(
        {
          error: meteringResult.error.getUserMessage(),
          code: meteringResult.error.code,
          retryable: meteringResult.error.isRetryable
        },
        { status: meteringResult.error.statusCode }
      )

      // Add retry-after header if applicable
      const retryAfter = meteringResult.error.getRetryAfter()
      if (retryAfter) {
        errorResponse.headers.set('Retry-After', retryAfter.toString())
      }

      return { success: false, error: errorResponse }
    }

    if (!meteringResult.decision.allowed) {
      return {
        success: false,
        error: NextResponse.json(
          {
            error: meteringResult.decision.reason || 'Access denied',
            code: 'ACCESS_DENIED'
          },
          { status: 403 }
        )
      }
    }

    // Execute the operation
    const result = await operation()

    // Record usage if operation succeeded and callback provided
    if (onSuccess && meteringResult.decision.reservationId) {
      try {
        await onSuccess(result, meteringResult.decision.reservationId)
      } catch (usageError) {
        // Log usage error but don't fail the operation
        console.error('Failed to record usage:', usageError)
      }
    }

    return { success: true, data: result }

  } catch (error) {
    // If metering system fails, allow operation to proceed (fail-open)
    console.error('Metering system error, proceeding without metering:', error)

    try {
      const result = await operation()
      return { success: true, data: result }
    } catch (operationError) {
      return {
        success: false,
        error: NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        )
      }
    }
  }
}
