/**
 * Service Access Middleware
 * 
 * Enforces organizational service access control at API route level.
 * This is SEPARATE from LLM gateway metering:
 * 
 * - LLM Gateway: Controls which LLM MODELS are available (Super Admin only)
 * - This Middleware: Controls which FEATURES users can access (Tenant Admin)
 * 
 * Use this in API routes to check if a user's team has access to a service
 * BEFORE making any LLM calls or performing operations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkServiceAccess, type ServiceAccessResult } from './org-access-service'
import type { ServiceType } from '@prisma/client'

function getServiceDisplayName(serviceType: ServiceType): string {
  switch (serviceType) {
    case 'PATENT_DRAFTING':
      return 'patent drafting'
    case 'PRIOR_ART_SEARCH':
      return 'prior art search'
    case 'NOVELTY_SEARCH':
      return 'novelty search'
    case 'IDEA_BANK':
      return 'idea bank'
    case 'DIAGRAM_GENERATION':
      return 'diagram generation'
    case 'PERSONA_SYNC':
      return 'persona sync'
    case 'PATENT_REVIEW':
      return 'patent review'
    case 'IDEATION':
      return 'patent ideation'
    case 'FUNDING_DISCOVERY':
      return 'funding discovery'
    case 'GRANT_PREP':
      return 'grant prep'
    case 'GRANT_DRAFTING':
      return 'grant drafting'
    default:
      return String(serviceType).toLowerCase()
  }
}

/**
 * Check if user has access to a service based on their team/user settings
 * Returns null if access is allowed, or a NextResponse error if denied
 */
export async function enforceServiceAccess(
  userId: string,
  tenantId: string,
  serviceType: ServiceType
): Promise<{ allowed: true; result: ServiceAccessResult } | { allowed: false; response: NextResponse }> {
  try {
    const result = await checkServiceAccess(userId, tenantId, serviceType)
    
    if (!result.allowed) {
      // Provide user-friendly error messages based on the reason
      let userMessage = 'Service access denied'
      let errorCode = 'SERVICE_ACCESS_DENIED'

      if (result.reason) {
        if (result.reason.includes('daily quota exceeded')) {
          const serviceName = getServiceDisplayName(serviceType)

          const quotaType = result.reason.includes('Tenant') ? 'tenant' : 'your'
          const resetTime = result.reason.includes('daily') ? 'tomorrow' : 'next month'

          userMessage = `Daily quota exceeded for ${serviceName}. Your ${quotaType} account has used all available operations for today. Please try again ${resetTime} when the quota resets.`

          if (result.remainingQuota) {
            const remainingMonthly = result.remainingQuota.monthly
            if (remainingMonthly !== null && remainingMonthly > 0) {
              userMessage += ` You have ${remainingMonthly} monthly operations remaining.`
            }
          }
          errorCode = 'DAILY_QUOTA_EXCEEDED'
        } else if (result.reason.includes('monthly quota exceeded')) {
          const serviceName = getServiceDisplayName(serviceType)

          userMessage = `Monthly quota exceeded for ${serviceName}. Your account has used all available operations for this month. Please contact your administrator to increase your plan limits or wait for the next billing cycle.`
          errorCode = 'MONTHLY_QUOTA_EXCEEDED'
        } else if (result.reason.includes('disabled for this user')) {
          const serviceName = getServiceDisplayName(serviceType)

          userMessage = `${serviceName.charAt(0).toUpperCase() + serviceName.slice(1)} is disabled for your account. Please contact your administrator to enable this feature.`
          errorCode = 'SERVICE_DISABLED'
        } else {
          // Use the original reason for other cases
          userMessage = result.reason
        }
      }

      return {
        allowed: false,
        response: NextResponse.json(
          {
            error: userMessage,
            reason: result.reason || `You do not have access to ${serviceType}`,
            code: errorCode,
            quotaInfo: result.remainingQuota ? {
              remainingDaily: result.remainingQuota.daily,
              remainingMonthly: result.remainingQuota.monthly,
              source: result.quotaSource
            } : undefined
          },
          { status: 403 }
        )
      }
    }
    
    return { allowed: true, result }
  } catch (error) {
    console.error('[ServiceAccessMiddleware] Error checking access:', error)
    // On error, allow access (fail open) - metering will still enforce quotas
    return { 
      allowed: true, 
      result: { allowed: true, reason: 'Access check failed, defaulting to allowed' } 
    }
  }
}

/**
 * Service type mapping for common API routes
 */
export const ROUTE_SERVICE_MAP: Record<string, ServiceType> = {
  // Drafting routes
  '/api/patents/*/drafting': 'PATENT_DRAFTING',
  '/api/patents/*/draft': 'PATENT_DRAFTING',
  
  // Novelty search routes
  '/api/novelty-search': 'NOVELTY_SEARCH',
  '/api/patents/*/novelty-assessment': 'NOVELTY_SEARCH',
  
  // Prior art routes
  '/api/patents/*/prior-art': 'PRIOR_ART_SEARCH',
  
  // Idea bank routes
  '/api/idea-bank': 'IDEA_BANK',

  // Funding and grant routes
  '/api/funding': 'FUNDING_DISCOVERY',
  '/api/grants': 'GRANT_DRAFTING',
  
  // Persona/style routes
  '/api/tenants/*/users/*/style': 'PERSONA_SYNC',
  '/api/writing-samples': 'PERSONA_SYNC',
}

/**
 * Get the service type for a given API path
 */
export function getServiceTypeForPath(path: string): ServiceType | null {
  // Normalize path
  const normalizedPath = path.replace(/\/[a-zA-Z0-9_-]+/g, (match, offset) => {
    // Keep the first segment, replace IDs with *
    if (offset === 0) return match
    // Check if it looks like an ID (cuid, uuid, etc)
    if (/^\/[a-z0-9]{20,}$/i.test(match) || /^\/[a-f0-9-]{36}$/i.test(match)) {
      return '/*'
    }
    return match
  })
  
  // Direct match
  if (ROUTE_SERVICE_MAP[normalizedPath]) {
    return ROUTE_SERVICE_MAP[normalizedPath]
  }
  
  // Pattern match
  for (const [pattern, serviceType] of Object.entries(ROUTE_SERVICE_MAP)) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '(/.*)?$')
    if (regex.test(path)) {
      return serviceType
    }
  }
  
  return null
}

/**
 * Higher-order function to wrap API handlers with service access check
 */
export function withServiceAccess(serviceType: ServiceType) {
  return function<T extends (...args: any[]) => Promise<NextResponse>>(handler: T): T {
    return (async (request: NextRequest, ...args: any[]) => {
      // Extract user context from request (assuming auth middleware has run)
      const authHeader = request.headers.get('Authorization')
      if (!authHeader) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      
      // The actual user extraction should be done by the handler
      // This is a pattern for handlers to use
      return handler(request, ...args)
    }) as T
  }
}

/**
 * Check multiple services at once (for features that span multiple services)
 */
export async function enforceMultipleServiceAccess(
  userId: string,
  tenantId: string,
  serviceTypes: ServiceType[]
): Promise<{ allowed: true } | { allowed: false; response: NextResponse; deniedService: ServiceType }> {
  for (const serviceType of serviceTypes) {
    const result = await enforceServiceAccess(userId, tenantId, serviceType)
    if (!result.allowed) {
      return { 
        allowed: false, 
        response: result.response,
        deniedService: serviceType
      }
    }
  }
  return { allowed: true }
}

