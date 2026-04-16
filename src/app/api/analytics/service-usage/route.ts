import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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

    // Fetch drafting sessions per user (proxy for patents drafted)
    const draftingByUser = await prisma.draftingSession.groupBy({
      by: ['userId'],
      where: {
        createdAt: dateRange,
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      },
      _count: { _all: true },
    })

    // Fetch novelty searches per user
    const noveltyByUser = await prisma.noveltySearchRun.groupBy({
      by: ['userId'],
      where: {
        createdAt: dateRange,
        status: 'COMPLETED',
        ...(query.tenantId
          ? {
              user: {
                tenantId: query.tenantId,
              },
            }
          : {}),
      },
      _count: { _all: true },
    })

    // Fetch idea reservations per user
    const reservationsByUser = await prisma.ideaBankReservation.groupBy({
      by: ['userId'],
      where: {
        reservedAt: dateRange,
        ...(query.tenantId
          ? {
              user: {
                tenantId: query.tenantId,
              },
            }
          : {}),
      },
      _count: { _all: true },
    })

    const userIds = Array.from(
      new Set([
        ...draftingByUser.map((r) => r.userId),
        ...noveltyByUser.map((r) => r.userId),
        ...reservationsByUser.map((r) => r.userId),
      ])
    )

    if (userIds.length === 0) {
      return NextResponse.json({
        startDate,
        endDate,
        users: [],
        summary: {
          totalPatentsDrafted: 0,
          totalNoveltySearches: 0,
          totalIdeasReserved: 0,
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

    const draftingMap = new Map<string, number>()
    draftingByUser.forEach((row) => draftingMap.set(row.userId, row._count._all))

    const noveltyMap = new Map<string, number>()
    noveltyByUser.forEach((row) => noveltyMap.set(row.userId, row._count._all))

    const reservationMap = new Map<string, number>()
    reservationsByUser.forEach((row) => reservationMap.set(row.userId, row._count._all))

    let totalPatentsDrafted = 0
    let totalNoveltySearches = 0
    let totalIdeasReserved = 0

    const resultUsers = users.map((u) => {
      const patentsDrafted = draftingMap.get(u.id) || 0
      const noveltySearches = noveltyMap.get(u.id) || 0
      const ideasReserved = reservationMap.get(u.id) || 0

      totalPatentsDrafted += patentsDrafted
      totalNoveltySearches += noveltySearches
      totalIdeasReserved += ideasReserved

      return {
        userId: u.id,
        userName: u.name || u.email,
        userEmail: u.email,
        tenantId: u.tenantId,
        tenantName: u.tenant?.name || null,
        tenantType: u.tenant?.type || null,
        patentsDrafted,
        noveltySearches,
        ideasReserved,
      }
    })

    // Sort users by total activity descending
    resultUsers.sort(
      (a, b) =>
        b.patentsDrafted +
        b.noveltySearches +
        b.ideasReserved -
        (a.patentsDrafted + a.noveltySearches + a.ideasReserved)
    )

    return NextResponse.json({
      startDate,
      endDate,
      users: resultUsers,
      summary: {
        totalPatentsDrafted,
        totalNoveltySearches,
        totalIdeasReserved,
      },
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
