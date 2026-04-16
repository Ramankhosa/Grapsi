/**
 * Trial Campaign Invites API - List, Import, Manage
 * GET  - List invites with filtering
 * POST - Import invites from JSON array
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'
import { importInvites, getInvites, resendInvite, InviteImportRow } from '@/lib/trial-invite-service'

const importSchema = z.object({
  invites: z.array(z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    country: z.string().optional(),
    company: z.string().optional(),
    jobTitle: z.string().optional()
  }).passthrough()) // Allow additional custom fields
})

const bulkActionSchema = z.object({
  action: z.enum(['delete', 'resend']),
  inviteIds: z.array(z.string()).min(1)
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

    // Get query params
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search') || undefined
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')

    const result = await getInvites(campaignId, {
      status: status ? status.split(',') as any : undefined,
      search,
      page,
      pageSize
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('List invites error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to list invites' },
      { status: 500 }
    )
  }
}

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

    // Check campaign exists
    const campaign = await prisma.trialCampaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      return NextResponse.json({ code: 'NOT_FOUND', message: 'Campaign not found' }, { status: 404 })
    }

    const body = await request.json()
    const { invites } = importSchema.parse(body)

    const result = await importInvites(campaignId, invites as InviteImportRow[])

    return NextResponse.json({
      message: `Imported ${result.imported} invites`,
      ...result
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid input', errors: error.errors },
        { status: 400 }
      )
    }
    console.error('Import invites error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to import invites' },
      { status: 500 }
    )
  }
}

// Bulk actions
export async function PATCH(
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
    const { action, inviteIds } = bulkActionSchema.parse(body)

    if (action === 'delete') {
      // Only delete pending invites
      const result = await prisma.trialInvite.deleteMany({
        where: {
          id: { in: inviteIds },
          campaignId,
          status: 'PENDING'
        }
      })

      // Update campaign stats
      await prisma.trialCampaign.update({
        where: { id: campaignId },
        data: {
          totalInvites: { decrement: result.count }
        }
      })

      return NextResponse.json({
        message: `Deleted ${result.count} invites`,
        deleted: result.count
      })
    }

    if (action === 'resend') {
      const results = await Promise.all(
        inviteIds.map(id => resendInvite(id, 'bulk_resend'))
      )

      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success)

      return NextResponse.json({
        message: `Resent ${successful} invites`,
        successful,
        failed: failed.length,
        errors: failed.map(f => f.error)
      })
    }

    return NextResponse.json({ code: 'INVALID_ACTION', message: 'Unknown action' }, { status: 400 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid input', errors: error.errors },
        { status: 400 }
      )
    }
    console.error('Bulk action error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to perform action' },
      { status: 500 }
    )
  }
}

