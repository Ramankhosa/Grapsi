/**
 * Trial Campaign Analytics API - Get campaign performance metrics
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { getCampaignAnalytics } from '@/lib/trial-invite-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params
    
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Missing token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload || !payload.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ code: 'FORBIDDEN', message: 'Super admin access required' }, { status: 403 })
    }

    const analytics = await getCampaignAnalytics(campaignId)

    return NextResponse.json(analytics)
  } catch (error) {
    console.error('Get analytics error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to get analytics' },
      { status: 500 }
    )
  }
}

