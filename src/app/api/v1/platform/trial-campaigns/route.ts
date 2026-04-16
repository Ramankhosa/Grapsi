/**
 * Trial Campaigns API - List and Create
 * GET  - List all campaigns
 * POST - Create new campaign
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'
import { createCampaign } from '@/lib/trial-invite-service'

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  emailSubject: z.string().max(200).optional(),
  emailTemplate: z.string().optional(),
  senderName: z.string().max(100).optional(),
  replyToEmail: z.string().email().optional(),
  trialDurationDays: z.number().min(1).max(365).optional(),
  inviteExpiryDays: z.number().min(1).max(365).optional(),
  defaultSendTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  maxSignups: z.number().min(1).optional(),
  // Trial Plan Limits
  patentDraftLimit: z.number().min(1).max(100).optional(),
  noveltySearchLimit: z.number().min(1).max(100).optional(),
  ideationRunLimit: z.number().min(1).max(100).optional(),
  priorArtSearchLimit: z.number().min(1).max(100).optional(),
  diagramLimit: z.number().min(1).max(200).optional(),
  totalTokenBudget: z.number().min(10000).max(10000000).optional()
})

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

    // Only super admins can access
    if (!payload.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ code: 'FORBIDDEN', message: 'Super admin access required' }, { status: 403 })
    }

    // Get query params
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    const where: any = {}
    if (status) {
      where.status = status
    }

    const [campaigns, total] = await Promise.all([
      prisma.trialCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: {
            select: { invites: true }
          }
        }
      }),
      prisma.trialCampaign.count({ where })
    ])

    return NextResponse.json({
      campaigns: campaigns.map(c => ({
        ...c,
        inviteCount: c._count.invites,
        _count: undefined
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    })
  } catch (error) {
    console.error('List campaigns error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to list campaigns' },
      { status: 500 }
    )
  }
}

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

    // Only super admins can create campaigns
    if (!payload.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ code: 'FORBIDDEN', message: 'Super admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const input = createCampaignSchema.parse(body)

    // Get platform tenant
    const platformTenant = await prisma.tenant.findFirst({
      where: { atiId: 'PLATFORM' }
    })

    if (!platformTenant) {
      return NextResponse.json(
        { code: 'CONFIG_ERROR', message: 'Platform tenant not configured' },
        { status: 500 }
      )
    }

    const campaign = await createCampaign(input, payload.sub, platformTenant.id)

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid input', errors: error.errors },
        { status: 400 }
      )
    }
    console.error('Create campaign error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to create campaign' },
      { status: 500 }
    )
  }
}

