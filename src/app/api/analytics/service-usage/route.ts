import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  collectServiceUsage,
  emptyServiceUsageCounts,
  NO_USER_KEY,
  totalServiceActions,
} from '@/lib/usage/service-usage-metrics'
import { z } from 'zod'

// Force dynamic rendering for API routes that use headers
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  tenantId: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify token and get user info via whoami endpoint
    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()

    const user = await prisma.user.findUnique({
      where: { email: userData.email },
      include: { tenant: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isSuperAdmin = user.roles?.some((role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const getParam = (key: string) => {
      const value = searchParams.get(key)
      return value === null ? undefined : value
    }

    const query = QuerySchema.parse({
      startDate: getParam('startDate'),
      endDate: getParam('endDate'),
      tenantId: getParam('tenantId'),
    })

    const endDate = query.endDate ? new Date(query.endDate) : new Date()
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000) // default last 30 days

    // Normalize to full-day boundaries
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)

    // Base where clauses
    const userWhere: any = {}
    if (query.tenantId) {
      userWhere.tenantId = query.tenantId
    }

    const dateRange = {
      gte: startDate,
      lte: endDate,
    }

    // Funding intelligence runs, reviewer runs and funding chat usage per user
    const serviceUsage = await collectServiceUsage(
      dateRange,
      query.tenantId ? { tenantId: query.tenantId } : {}
    )

    const userIds = Array.from(serviceUsage.byUser.keys()).filter((id) => id !== NO_USER_KEY)

    if (userIds.length === 0) {
      return NextResponse.json({
        startDate,
        endDate,
        users: [],
        summary: {
          totalFundingIntelligenceRuns: 0,
          totalReviewerRuns: 0,
          totalReviewerCalls: 0,
          totalChatSessions: 0,
          totalChatMessages: 0,
        },
      })
    }

    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        ...userWhere,
      },
      select: {
        id: true,
        email: true,
        name: true,
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    })

    const summary = {
      totalFundingIntelligenceRuns: 0,
      totalReviewerRuns: 0,
      totalReviewerCalls: 0,
      totalChatSessions: 0,
      totalChatMessages: 0,
    }

    const resultUsers = users.map((u) => {
      const counts = serviceUsage.byUser.get(u.id) ?? emptyServiceUsageCounts()

      summary.totalFundingIntelligenceRuns += counts.fundingIntelligenceRuns
      summary.totalReviewerRuns += counts.reviewerRuns
      summary.totalReviewerCalls += counts.reviewerCalls
      summary.totalChatSessions += counts.chatSessions
      summary.totalChatMessages += counts.chatMessages

      return {
        userId: u.id,
        userName: u.name || u.email,
        userEmail: u.email,
        tenantId: u.tenantId,
        tenantName: u.tenant?.name || null,
        tenantType: u.tenant?.type || null,
        ...counts,
      }
    })

    // Sort users by total activity descending
    resultUsers.sort((a, b) => totalServiceActions(b) - totalServiceActions(a))

    return NextResponse.json({
      startDate,
      endDate,
      users: resultUsers,
      summary,
    })
  } catch (error) {
    console.error('Service usage analytics API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
