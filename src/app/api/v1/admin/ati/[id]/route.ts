import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { createAuditLog } from '@/lib/auth'

const extendSchema = z.object({
  expires_at: z.string() // ISO date string
})

const maxUsesSchema = z.object({
  max_uses: z.number().min(1)
})

const updateTokenSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ISSUED', 'REVOKED', 'EXPIRED', 'USED_UP']).optional(),
  expires_at: z.string().optional(), // ISO date string
  max_uses: z.number().min(1).optional(),
  plan_tier: z.string().optional(),
  notes: z.string().optional()
})

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate and check role
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const tokenId = params.id

    if (!user.tenant_id) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant to view this token' },
        { status: 403 }
      )
    }

    const token = await prisma.aTIToken.findFirst({
      where: {
        id: tokenId,
        tenantId: user.tenant_id
      },
      include: {
        signupUsers: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            roles: true,
            createdAt: true
          }
        }
      }
    })

    if (!token) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    const signupUsers = token.signupUsers
    const userIds = signupUsers.map(u => u.id)

    const userMetrics: Record<string, {
      patentsDrafted: number
      noveltySearches: number
      totalInputTokens: number
      totalOutputTokens: number
      tokensByModel: Array<{ model: string; inputTokens: number; outputTokens: number }>
      tokensByTask: Array<{ task: string; inputTokens: number; outputTokens: number }>
    }> = {}

    if (userIds.length > 0) {
      // Initialize metrics map
      for (const id of userIds) {
        userMetrics[id] = {
          patentsDrafted: 0,
          noveltySearches: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          tokensByModel: [],
          tokensByTask: []
        }
      }

      // Patents drafted (by creator)
      const patentsByUser = await prisma.patent.groupBy({
        by: ['createdBy'],
        where: {
          createdBy: { in: userIds }
        },
        _count: { _all: true }
      })

      for (const row of patentsByUser) {
        const metrics = userMetrics[row.createdBy]
        if (metrics) {
          metrics.patentsDrafted = row._count._all
        }
      }

      // Novelty searches run (completed)
      const noveltyByUser = await prisma.noveltySearchRun.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          status: 'COMPLETED'
        },
        _count: { _all: true }
      })

      for (const row of noveltyByUser) {
        const metrics = userMetrics[row.userId]
        if (metrics) {
          metrics.noveltySearches = row._count._all
        }
      }

      // LLM token usage by user/model/task from UsageLog
      const usageByUser = await prisma.usageLog.groupBy({
        by: ['userId', 'modelClass', 'taskCode', 'tenantId', 'status'],
        where: {
          userId: { in: userIds },
          tenantId: user.tenant_id,
          status: 'COMPLETED'
        },
        _sum: {
          inputTokens: true,
          outputTokens: true
        }
      })

      for (const row of usageByUser) {
        const uid = row.userId
        const metrics = uid ? userMetrics[uid] : undefined
        if (!metrics) continue

        const input = row._sum.inputTokens || 0
        const output = row._sum.outputTokens || 0

        metrics.totalInputTokens += input
        metrics.totalOutputTokens += output

        const modelKey = row.modelClass || 'UNKNOWN_MODEL'
        let modelEntry = metrics.tokensByModel.find(m => m.model === modelKey)
        if (!modelEntry) {
          modelEntry = { model: modelKey, inputTokens: 0, outputTokens: 0 }
          metrics.tokensByModel.push(modelEntry)
        }
        modelEntry.inputTokens += input
        modelEntry.outputTokens += output

        const taskKey = row.taskCode || 'UNKNOWN_TASK'
        let taskEntry = metrics.tokensByTask.find(t => t.task === taskKey)
        if (!taskEntry) {
          taskEntry = { task: taskKey, inputTokens: 0, outputTokens: 0 }
          metrics.tokensByTask.push(taskEntry)
        }
        taskEntry.inputTokens += input
        taskEntry.outputTokens += output
      }
    }

    return NextResponse.json({
      id: token.id,
      fingerprint: token.fingerprint,
      status: token.status,
      expires_at: token.expiresAt?.toISOString(),
      max_uses: token.maxUses,
      usage_count: token.usageCount,
      plan_tier: token.planTier,
      notes: token.notes,
      created_at: token.createdAt.toISOString(),
      updated_at: token.updatedAt.toISOString(),
      signup_users: signupUsers.map(su => ({
        id: su.id,
        email: su.email,
        first_name: su.firstName,
        last_name: su.lastName,
        roles: su.roles,
        created_at: su.createdAt.toISOString(),
        usage_metrics: userMetrics[su.id] || {
          patentsDrafted: 0,
          noveltySearches: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          tokensByModel: [],
          tokensByTask: []
        }
      }))
    }, { status: 200 })

  } catch (error) {
    console.error('ATI detail error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate and check role
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const tokenId = params.id
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') // extend or max-uses

    // Verify token belongs to user's tenant
    if (!user.tenant_id) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant to perform this action' },
        { status: 403 }
      )
    }
    
    const token = await prisma.aTIToken.findFirst({
      where: {
        id: tokenId,
        tenantId: user.tenant_id
      }
    })

    if (!token) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    if (action === 'extend') {
      const body = await request.json()
      const { expires_at } = extendSchema.parse(body)

      // Update token
      await prisma.aTIToken.update({
        where: { id: tokenId },
        data: { expiresAt: new Date(expires_at) }
      })

      // Audit log
      await createAuditLog({
        actorUserId: user.sub,
        tenantId: user.tenant_id,
        action: 'ATI_EXTEND',
        resource: `ati_token:${tokenId}`,
        ip,
        meta: {
          fingerprint: token.fingerprint,
          newExpiresAt: expires_at
        }
      })

      return NextResponse.json({ success: true }, { status: 200 })

    } else if (action === 'max-uses') {
      const body = await request.json()
      const { max_uses } = maxUsesSchema.parse(body)

      // Update token
      await prisma.aTIToken.update({
        where: { id: tokenId },
        data: { maxUses: max_uses }
      })

      // Check if now used up
      if (token.usageCount >= max_uses) {
        await prisma.aTIToken.update({
          where: { id: tokenId },
          data: { status: 'USED_UP' }
        })
      }

      // Audit log
      await createAuditLog({
        actorUserId: user.sub,
        tenantId: user.tenant_id,
        action: 'ATI_MAX_USES_UPDATE',
        resource: `ati_token:${tokenId}`,
        ip,
        meta: {
          fingerprint: token.fingerprint,
          newMaxUses: max_uses,
          currentUsage: token.usageCount
        }
      })

      return NextResponse.json({ success: true }, { status: 200 })
    }

    return NextResponse.json(
      { code: 'INVALID_ACTION', message: 'Invalid action parameter' },
      { status: 400 }
    )

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('ATI action error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate and check role
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const tokenId = params.id

    // Verify token belongs to user's tenant and revoke it
    if (!user.tenant_id) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant to perform this action' },
        { status: 403 }
      )
    }
    
    const token = await prisma.aTIToken.findFirst({
      where: {
        id: tokenId,
        tenantId: user.tenant_id
      }
    })

    if (!token) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    // Update status to REVOKED
    await prisma.aTIToken.update({
      where: { id: tokenId },
      data: { status: 'REVOKED' }
    })

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: user.sub,
      tenantId: user.tenant_id,
      action: 'ATI_REVOKE',
      resource: `ati_token:${tokenId}`,
      ip,
      meta: {
        fingerprint: token.fingerprint,
        previousStatus: token.status
      }
    })

    return NextResponse.json({ success: true }, { status: 200 })

  } catch (error) {
    console.error('ATI revoke error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate and check role
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const tokenId = params.id

    // Verify token belongs to user's tenant
    if (!user.tenant_id) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant to perform this action' },
        { status: 403 }
      )
    }
    
    const existingToken = await prisma.aTIToken.findFirst({
      where: {
        id: tokenId,
        tenantId: user.tenant_id
      }
    })

    if (!existingToken) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const updates = updateTokenSchema.parse(body)

    // Build update object
    const updateData: any = {}
    if (updates.status !== undefined) updateData.status = updates.status
    if (updates.expires_at !== undefined) updateData.expiresAt = updates.expires_at ? new Date(updates.expires_at) : null
    if (updates.max_uses !== undefined) updateData.maxUses = updates.max_uses
    if (updates.plan_tier !== undefined) updateData.planTier = updates.plan_tier
    if (updates.notes !== undefined) updateData.notes = updates.notes

    // Update token
    const updatedToken = await prisma.aTIToken.update({
      where: { id: tokenId },
      data: updateData
    })

    // Check if status change affects usage (e.g., if setting to USED_UP but not actually used up)
    if (updates.status === 'USED_UP' && existingToken.usageCount < (updates.max_uses || existingToken.maxUses || 0)) {
      // If setting to USED_UP but usage count is lower, update usage count to match max_uses
      const maxUses = updates.max_uses || existingToken.maxUses || 1
      await prisma.aTIToken.update({
        where: { id: tokenId },
        data: { usageCount: maxUses }
      })
    }

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: user.sub,
      tenantId: user.tenant_id,
      action: 'ATI_UPDATE',
      resource: `ati_token:${tokenId}`,
      ip,
      meta: {
        fingerprint: existingToken.fingerprint,
        previousData: {
          status: existingToken.status,
          expiresAt: existingToken.expiresAt,
          maxUses: existingToken.maxUses,
          planTier: existingToken.planTier,
          notes: existingToken.notes
        },
        newData: updateData
      }
    })

    return NextResponse.json({
      success: true,
      token: {
        id: updatedToken.id,
        fingerprint: updatedToken.fingerprint,
        status: updatedToken.status,
        expires_at: updatedToken.expiresAt?.toISOString(),
        max_uses: updatedToken.maxUses,
        usage_count: updatedToken.usageCount,
        plan_tier: updatedToken.planTier,
        notes: updatedToken.notes,
        created_at: updatedToken.createdAt.toISOString(),
        updated_at: updatedToken.updatedAt.toISOString()
      }
    }, { status: 200 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('ATI update error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
