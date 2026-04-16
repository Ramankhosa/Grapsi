/**
 * Trial Quota API - Get user's trial usage and limits
 * GET - Returns trial quota status for the authenticated user
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { getTrialQuotaStatus, checkTrialQuota } from '@/lib/trial-plan-service'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Missing token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Invalid token' }, { status: 401 })
    }

    const status = await getTrialQuotaStatus(payload.sub)

    return NextResponse.json(status)
  } catch (error) {
    console.error('Get trial quota error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to get trial quota' },
      { status: 500 }
    )
  }
}

/**
 * POST - Check if a specific action is allowed
 * Body: { action: 'patent' | 'noveltySearch' | 'ideation' | 'priorArt' | 'diagram' }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Missing token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (!action || !['patent', 'noveltySearch', 'ideation', 'priorArt', 'diagram'].includes(action)) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid action. Must be one of: patent, noveltySearch, ideation, priorArt, diagram' },
        { status: 400 }
      )
    }

    const result = await checkTrialQuota(payload.sub, action)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Check trial quota error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to check trial quota' },
      { status: 500 }
    )
  }
}

