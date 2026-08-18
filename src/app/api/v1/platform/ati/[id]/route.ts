import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { allTimeRange, collectServiceUsage } from '@/lib/usage/service-usage-metrics'
import { createAuditLog } from '@/lib/auth'
import { requirePlatformScope, authenticateRequest } from '@/lib/middleware'

const updateTokenSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ISSUED', 'REVOKED', 'EXPIRED', 'USED_UP']).optional(),
  expires_at: z.string().optional(), // ISO date string
  max_uses: z.number().min(1).optional(),
  plan_tier: z.string().optional(),
  notes: z.string().optional(),
  assigned_role: z.enum(['ADMIN', 'MANAGER', 'ANALYST']).nullable().optional(),
  assigned_team_id: z.string().nullable().optional()
})

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const tokenId = params.id

    const token = await prisma.aTIToken.findFirst({
      where: { id: tokenId },
      include: {
        tenant: true,
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
      fundingIntelligenceRuns: number
      reviewerRuns: number
      reviewerCalls: number
      chatSessions: number
      chatMessages: number
      totalInputTokens: number
      totalOutputTokens: number
      tokensByModel: Array<{ model: string; inputTokens: number; outputTokens: number }>
      tokensByTask: Array<{ task: string; inputTokens: number; outputTokens: number }>
    }> = {}

    if (userIds.length > 0) {
      for (const id of userIds) {
        userMetrics[id] = {
          fundingIntelligenceRuns: 0,
          reviewerRuns: 0,
          reviewerCalls: 0,
          chatSessions: 0,
          chatMessages: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          tokensByModel: [],
          tokensByTask: []
        }
      }

      // Lifetime funding-service activity for the users this token signed up.
      const serviceUsage = await collectServiceUsage(allTimeRange(), { userIds })

      for (const id of userIds) {
        const counts = serviceUsage.byUser.get(id)
        if (!counts) continue
        const metrics = userMetrics[id]
        metrics.fundingIntelligenceRuns = counts.fundingIntelligenceRuns
        metrics.reviewerRuns = counts.reviewerRuns
        metrics.reviewerCalls = counts.reviewerCalls
        metrics.chatSessions = counts.chatSessions
        metrics.chatMessages = counts.chatMessages
      }

      const usageByUser = await prisma.usageLog.groupBy({
        by: ['userId', 'modelClass', 'taskCode', 'tenantId', 'status'],
        where: {
          userId: { in: userIds },
          tenantId: token.tenantId || undefined,
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
      assigned_role: token.assignedRole,
      assigned_team_id: token.assignedTeamId,
      created_at: token.createdAt.toISOString(),
      updated_at: token.updatedAt.toISOString(),
      ...(token.tenant && {
        tenant: {
          id: token.tenant.id,
          name: token.tenant.name,
          ati_id: token.tenant.atiId
        }
      }),
      signup_users: signupUsers.map(su => ({
        id: su.id,
        email: su.email,
        first_name: su.firstName,
        last_name: su.lastName,
        roles: su.roles,
        created_at: su.createdAt.toISOString(),
        usage_metrics: userMetrics[su.id] || {
          fundingIntelligenceRuns: 0,
          reviewerRuns: 0,
          reviewerCalls: 0,
          chatSessions: 0,
          chatMessages: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          tokensByModel: [],
          tokensByTask: []
        }
      }))
    }, { status: 200 })

  } catch (error) {
    console.error('Super Admin ATI detail error:', error)
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
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Get authenticated user for audit logging
    const { user: authUser } = await authenticateRequest(request)

    const tokenId = params.id

    // Get existing token with tenant info
    const existingToken = await prisma.aTIToken.findFirst({
      where: { id: tokenId },
      include: { tenant: true }
    })

    if (!existingToken) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const updates = updateTokenSchema.parse(body)

    if (updates.assigned_team_id) {
      const team = await prisma.team.findFirst({
        where: { id: updates.assigned_team_id, tenantId: existingToken.tenantId!, isActive: true },
        select: { id: true }
      })
      if (!team) {
        return NextResponse.json(
          { code: 'INVALID_TEAM', message: 'Assigned team must be active and belong to the token tenant' },
          { status: 400 }
        )
      }
    }

    // Build update object
    const updateData: any = {}
    if (updates.status !== undefined) updateData.status = updates.status
    if (updates.expires_at !== undefined) updateData.expiresAt = updates.expires_at ? new Date(updates.expires_at) : null
    if (updates.max_uses !== undefined) updateData.maxUses = updates.max_uses
    if (updates.plan_tier !== undefined) updateData.planTier = updates.plan_tier
    if (updates.notes !== undefined) updateData.notes = updates.notes
    if (updates.assigned_role !== undefined) updateData.assignedRole = updates.assigned_role
    if (updates.assigned_team_id !== undefined) updateData.assignedTeamId = updates.assigned_team_id

    // Update token
    const updatedToken = await prisma.aTIToken.update({
      where: { id: tokenId },
      data: updateData,
      include: { tenant: true }
    })

    // Check if status change affects usage
    if (updates.status === 'USED_UP' && existingToken.usageCount < (updates.max_uses || existingToken.maxUses || 0)) {
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
      actorUserId: authUser!.sub,
      tenantId: existingToken.tenantId || undefined,
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
        assigned_role: updatedToken.assignedRole,
        assigned_team_id: updatedToken.assignedTeamId,
        created_at: updatedToken.createdAt.toISOString(),
        updated_at: updatedToken.updatedAt.toISOString(),
        ...(updatedToken.tenant && {
          tenant: {
            id: updatedToken.tenant.id,
            name: updatedToken.tenant.name,
            ati_id: updatedToken.tenant.atiId
          }
        })
      }
    }, { status: 200 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Super Admin ATI update error:', error)
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
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Get authenticated user for audit logging
    const { user: authUser } = await authenticateRequest(request)

    const tokenId = params.id

    // Get token with tenant info before deleting
    const token = await prisma.aTIToken.findFirst({
      where: { id: tokenId },
      include: { tenant: true }
    })

    if (!token) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    // Update status to REVOKED instead of deleting
    await prisma.aTIToken.update({
      where: { id: tokenId },
      data: { status: 'REVOKED' }
    })

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: token.tenantId || undefined,
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
    console.error('Super Admin ATI revoke error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
