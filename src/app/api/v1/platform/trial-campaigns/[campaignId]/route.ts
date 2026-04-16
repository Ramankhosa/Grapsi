/**
 * Trial Campaign API - Get, Update, Delete specific campaign
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
  emailSubject: z.string().max(200).optional(),
  emailTemplate: z.string().optional(),
  senderName: z.string().max(100).optional(),
  replyToEmail: z.string().email().optional(),
  trialDurationDays: z.number().min(1).max(365).optional(),
  inviteExpiryDays: z.number().min(1).max(365).optional(),
  defaultSendTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  maxSignups: z.number().min(1).nullable().optional(),
  // Trial Plan Limits (can be updated anytime)
  patentDraftLimit: z.number().min(1).max(100).nullable().optional(),
  noveltySearchLimit: z.number().min(1).max(100).nullable().optional(),
  ideationRunLimit: z.number().min(1).max(100).nullable().optional(),
  priorArtSearchLimit: z.number().min(1).max(100).nullable().optional(),
  diagramLimit: z.number().min(1).max(200).nullable().optional(),
  totalTokenBudget: z.number().min(10000).max(1000000).nullable().optional()
})

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

    const campaign = await prisma.trialCampaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: {
          select: { invites: true }
        }
      }
    })

    if (!campaign) {
      return NextResponse.json({ code: 'NOT_FOUND', message: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...campaign,
      inviteCount: campaign._count.invites,
      _count: undefined
    })
  } catch (error) {
    console.error('Get campaign error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to get campaign' },
      { status: 500 }
    )
  }
}

export async function PUT(
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

    const body = await request.json()
    const input = updateCampaignSchema.parse(body)

    const campaign = await prisma.trialCampaign.update({
      where: { id: campaignId },
      data: input
    })

    return NextResponse.json(campaign)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid input', errors: error.errors },
        { status: 400 }
      )
    }
    console.error('Update campaign error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to update campaign' },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    // Only allow deleting draft campaigns or archiving active ones
    const campaign = await prisma.trialCampaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      return NextResponse.json({ code: 'NOT_FOUND', message: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.status === 'DRAFT') {
      // Actually delete draft campaigns
      await prisma.trialCampaign.delete({ where: { id: campaignId } })
      return NextResponse.json({ message: 'Campaign deleted' })
    } else {
      // Archive active/paused/completed campaigns
      await prisma.trialCampaign.update({
        where: { id: campaignId },
        data: { status: 'ARCHIVED' }
      })
      return NextResponse.json({ message: 'Campaign archived' })
    }
  } catch (error) {
    console.error('Delete campaign error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to delete campaign' },
      { status: 500 }
    )
  }
}

