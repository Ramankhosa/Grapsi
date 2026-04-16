// HTTP middleware for automatic metering integration

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { MeteringConfig } from './types'
import { enforceMetering } from './enforcement'

// Route configuration for metering
interface RouteMeteringConfig {
  featureCode: string
  taskCode?: string
  requireReservation?: boolean
}

const ROUTE_CONFIGS: Record<string, RouteMeteringConfig> = {
  '/api/patents': { featureCode: 'PATENT_DRAFTING', taskCode: 'LLM2_DRAFT' },
  '/api/search': { featureCode: 'PRIOR_ART_SEARCH' },
  '/api/diagrams': { featureCode: 'DIAGRAM_GENERATION', taskCode: 'LLM3_DIAGRAM' },
  '/api/patents/': { featureCode: 'PRIOR_ART_SEARCH', taskCode: 'LLM4_NOVELTY_SCREEN' }, // Novelty assessment
  // Add more routes as needed
}

// Extract metering config for a route
function getRouteMeteringConfig(pathname: string): RouteMeteringConfig | null {
  // Check for exact matches first
  if (ROUTE_CONFIGS[pathname]) {
    return ROUTE_CONFIGS[pathname]
  }

  // Check for pattern matches
  for (const [pattern, config] of Object.entries(ROUTE_CONFIGS)) {
    if (pathname.startsWith(pattern)) {
      return config
    }
  }

  return null
}

// Create middleware function
export function createMeteringMiddleware(config: MeteringConfig) {
  return async function meteringMiddleware(
    request: NextRequest,
    handler: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    // Skip if metering is disabled
    if (!config.enabled) {
      return handler()
    }

    const routeConfig = getRouteMeteringConfig(request.nextUrl.pathname)
    if (!routeConfig) {
      return handler()
    }

    try {
      // Extract tenant context from request
      const authHeader = request.headers.get('authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new NextResponse('Unauthorized', { status: 401 })
      }

      // For now, create a basic feature request
      // This will be enhanced when identity service is complete
      const featureRequest = {
        tenantId: 'placeholder', // Will be resolved from token
        featureCode: routeConfig.featureCode as any,
        taskCode: routeConfig.taskCode as any,
        metadata: {
          ip: request.headers.get('x-forwarded-for') || request.ip,
          userAgent: request.headers.get('user-agent') || undefined,
          correlationId: request.headers.get('x-correlation-id') || crypto.randomUUID(),
        }
      }

      // Convert headers for metering
      const headers: Record<string, string> = {}
      request.headers.forEach((value, key) => {
        headers[key] = value
      })

      // Enforce metering
      const result = await enforceMetering({ headers }, featureRequest)

      if (result.error) {
        const response = NextResponse.json(
          {
            code: result.error.code,
            message: result.error.getUserMessage()
          },
          { status: result.error.statusCode }
        )

        const retryAfter = result.error.getRetryAfter()
        if (retryAfter) {
          response.headers.set('Retry-After', retryAfter.toString())
        }

        return response
      }

      if (!result.decision.allowed) {
        return NextResponse.json(
          {
            code: 'ACCESS_DENIED',
            message: result.decision.reason || 'Access denied'
          },
          { status: 403 }
        )
      }

      // Proceed with request, add metering context to headers
      const enhancedRequest = new Request(request, {
        headers: {
          ...request.headers,
          'x-metering-allowed': 'true',
          'x-metering-reservation': result.decision.reservationId || '',
        }
      })

      return handler()
    } catch (error) {
      console.error('Metering middleware error:', error)

      // Fail open in production - allow request to proceed
      return handler()
    }
  }
}

// Helper to register routes for metering
export function registerMeteringRoute(path: string, config: RouteMeteringConfig): void {
  ROUTE_CONFIGS[path] = config
}
