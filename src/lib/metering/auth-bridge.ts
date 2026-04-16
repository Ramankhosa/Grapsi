// Bridge between existing JWT auth and metering system
// Safely extracts tenant context without breaking existing auth

import type { TenantContext } from './types'
import { verifyJWT, JWTPayload } from '@/lib/auth'

function getHeaderValue(headers: Record<string, string>, headerName: string): string | undefined {
  const normalizedHeaderName = headerName.toLowerCase()

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value
    }
  }

  return undefined
}

/**
 * Extract tenant context from existing JWT token
 * This bridges the gap between current auth and metering
 */
export async function extractTenantContextFromRequest(
  request: { headers: Record<string, string> } | { tenantContext: TenantContext }
): Promise<TenantContext | null> {
  try {
    // If tenant context is passed directly, use it
    if ('tenantContext' in request) {
      return request.tenantContext
    }

    // Check if headers exist
    if (!request.headers) {
      return null
    }

    // Extract JWT from Authorization header
    const authHeader = getHeaderValue(request.headers, 'authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.substring(7)
    let payload = verifyJWT(token) as JWTPayload

    // In development mode, try to parse expired tokens as a fallback
    if (!payload && process.env.NODE_ENV === 'development') {
      try {
        // Try to decode the JWT payload manually (ignoring signature verification for dev)
        const parts = token.split('.')
        if (parts.length === 3) {
          const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
          if (decodedPayload && decodedPayload.sub && decodedPayload.email) {
            console.log('Development mode: Using expired token payload as fallback')
            payload = decodedPayload as JWTPayload
          }
        }
      } catch (decodeError) {
        console.log('Failed to decode expired token in development mode:', decodeError)
      }
    }

    if (!payload) {
      return null
    }

    // If JWT already has tenant_id, try to resolve the plan
    if (payload.tenant_id && payload.ati_id) {
      const { createIdentityService, defaultConfig } = await import('./index')
      const identityService = createIdentityService(defaultConfig)

      // Try to resolve tenant context from ATI token
      const tenantContext = await identityService.resolveTenantContext(payload.ati_id)

      if (tenantContext) {
        return {
          ...tenantContext,
          userId: payload.sub // Add user ID from JWT
        }
      }
    }

    // Fallback: If we have tenant_id but ATI resolution failed, query tenant directly
    // This handles cases where ati_id is null or ATI-based resolution fails
    if (payload.tenant_id && payload.sub) {
      try {
        const { prisma } = await import('@/lib/prisma')
        
        // Find tenant and their active plan directly
        const tenant = await prisma.tenant.findUnique({
          where: { id: payload.tenant_id },
          include: {
            tenantPlans: {
              where: {
                status: 'ACTIVE',
                effectiveFrom: { lte: new Date() },
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } }
                ]
              },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
            }
          }
        })

        if (tenant && tenant.status === 'ACTIVE' && tenant.tenantPlans[0]) {
          console.log('Resolved tenant context via direct tenant query (fallback)')
          return {
            tenantId: tenant.id,
            planId: tenant.tenantPlans[0].planId,
            tenantStatus: tenant.status,
            userId: payload.sub
          }
        }
      } catch (directQueryError) {
        console.error('Direct tenant query fallback failed:', directQueryError)
      }
    }

    // In development mode, provide a fallback tenant context if all resolution fails
    if (process.env.NODE_ENV === 'development' && payload.sub && payload.email) {
      console.log('Development mode: Providing fallback tenant context')
      return {
        tenantId: payload.tenant_id || 'dev-tenant',
        userId: payload.sub,
        planId: 'DEVELOPMENT'
      }
    }

    return null
  } catch (error) {
    // Log error but don't break - metering should fail gracefully
    console.error('Failed to extract tenant context:', error)
    return null
  }
}

/**
 * Create a feature request from tenant context
 * Used for quick metering integration
 */
export function createFeatureRequest(
  tenantContext: TenantContext,
  featureCode: string,
  taskCode?: string
) {
  return {
    tenantId: tenantContext.tenantId,
    featureCode: featureCode as any,
    taskCode: taskCode as any,
    userId: tenantContext.userId
  }
}

/**
 * Usage recording helper for API operations
 * Records API calls as usage
 */
export async function recordApiUsage(
  reservationId: string,
  featureCode: string,
  operation: string = 'api_call'
) {
  const { createMeteringService, defaultConfig } = await import('./index')
  const meteringService = createMeteringService(defaultConfig)

  try {
    await meteringService.recordUsage(reservationId, {
      apiCalls: 1,
      apiCode: `${featureCode}_${operation}`.toUpperCase()
    }, undefined)
  } catch (error) {
    console.error('Failed to record API usage:', error)
    // Don't throw - usage recording failures shouldn't break operations
  }
}
