import { NextRequest, NextResponse } from 'next/server'

import { verifyJWT } from '@/lib/auth'
import { PatentNestApiError } from '@/lib/patentnest/client'

export function requirePatentNestUser(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'AUTH_REQUIRED', message: 'Authorization token required.' } },
      { status: 401 },
    )
  }

  const payload = verifyJWT(authHeader.slice(7))
  if (!payload) {
    return NextResponse.json(
      { error: { code: 'INVALID_TOKEN', message: 'Invalid or expired authorization token.' } },
      { status: 401 },
    )
  }

  return null
}

export function patentNestErrorResponse(error: unknown): NextResponse {
  if (error instanceof PatentNestApiError) {
    // Do not make an upstream key failure look like an expired Grapsi user session.
    const status = error.status === 401 || error.status === 403 ? 502 : error.status
    const headers = new Headers()
    if (error.requestId) headers.set('X-Request-ID', error.requestId)
    if (error.retryAfterSeconds !== undefined) {
      headers.set('Retry-After', String(error.retryAfterSeconds))
    }
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.requestId ? { requestId: error.requestId } : {}),
        },
      },
      { status, headers },
    )
  }

  console.error('[PatentNest] Unexpected proxy error', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unable to complete the patent request.' } },
    { status: 500 },
  )
}

export function patentNestSuccessResponse<T extends { meta?: { requestId?: string } }>(
  payload: T,
): NextResponse {
  const headers = new Headers()
  if (payload.meta?.requestId) headers.set('X-Request-ID', payload.meta.requestId)
  return NextResponse.json(payload, { headers })
}
