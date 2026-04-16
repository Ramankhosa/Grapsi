/**
 * Trial Campaign Send API - Send or schedule invite emails
 * POST - Send/schedule emails
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'
import { sendInvites } from '@/lib/trial-invite-service'

const sendSchema = z.object({
  inviteIds: z.array(z.string()).optional(),
  sendAll: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional() // ISO datetime string
})

export async function POST(
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

    // Check campaign exists and is active
    const campaign = await prisma.trialCampaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      return NextResponse.json({ code: 'NOT_FOUND', message: 'Campaign not found' }, { status: 404 })
    }

    // Activate campaign if it's in draft
    if (campaign.status === 'DRAFT') {
      await prisma.trialCampaign.update({
        where: { id: campaignId },
        data: { status: 'ACTIVE' }
      })
    } else if (campaign.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'CAMPAIGN_NOT_ACTIVE', message: 'Campaign must be active to send invites' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { inviteIds, sendAll, scheduledAt } = sendSchema.parse(body)

    if (!inviteIds?.length && !sendAll) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Must specify inviteIds or sendAll' },
        { status: 400 }
      )
    }

    const result = await sendInvites(campaignId, {
      inviteIds,
      sendAll,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined
    })

    if (result.scheduled > 0) {
      return NextResponse.json({
        message: `Scheduled ${result.scheduled} invites for ${scheduledAt}`,
        ...result
      })
    }

    return NextResponse.json({
      message: `Sent ${result.sent} invites (${result.failed} failed)`,
      ...result
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid input', errors: error.errors },
        { status: 400 }
      )
    }
    console.error('Send invites error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to send invites' },
      { status: 500 }
    )
  }
}

