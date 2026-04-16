import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sortBy: z
    .enum(['userName', 'inputTokens', 'outputTokens', 'cost', 'patentDrafts', 'noveltySearches', 'ideasReserved'])
    .optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
})

export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()
    const roles: string[] = Array.isArray(userData.roles) ? userData.roles : []
    const isSuperAdmin = roles.some(r => r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN_VIEWER')
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const getParam = (key: string) => {
      const value = searchParams.get(key)
      return value === null ? undefined : value
    }

    const parsed = QuerySchema.parse({
      startDate: getParam('startDate'),
      endDate: getParam('endDate'),
      page: getParam('page'),
      pageSize: getParam('pageSize'),
      sortBy: getParam('sortBy'),
      sortDir: getParam('sortDir')
    })

    const endDate = parsed.endDate ? new Date(parsed.endDate) : new Date()
    const startDate = parsed.startDate ? new Date(parsed.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)

    const dateRange = { gte: startDate, lte: endDate }

    // LLM usage logs for tokens + cost
    const [usageLogs, modelPrices, draftsByUser, noveltyRuns, reservations] = await Promise.all([
      prisma.usageLog.findMany({
        where: {
          tenantId: params.tenantId,
          startedAt: dateRange,
          status: 'COMPLETED'
        },
        select: {
          userId: true,
          inputTokens: true,
          outputTokens: true,
          apiCalls: true,
          modelClass: true,
          startedAt: true
        }
      }),
      prisma.lLMModelPrice.findMany(),
      prisma.draftingSession.groupBy({
        by: ['userId'],
        where: {
          tenantId: params.tenantId,
          createdAt: dateRange
        },
        _count: { _all: true }
      }),
      prisma.noveltySearchRun.findMany({
        where: {
          createdAt: dateRange,
          status: 'COMPLETED',
          user: { tenantId: params.tenantId }
        },
        select: { userId: true }
      }),
      prisma.ideaBankReservation.findMany({
        where: {
          reservedAt: dateRange,
          user: { tenantId: params.tenantId }
        },
        select: { userId: true }
      })
    ])

    const priceMap = new Map<string, { input: number; output: number }>()
    for (const p of modelPrices) {
      priceMap.set(p.modelClass, {
        input: p.inputPricePerMTokens,
        output: p.outputPricePerMTokens
      })
    }

    type UserBucket = {
      userId: string
      totalInputTokens: number
      totalOutputTokens: number
      totalApiCalls: number
      totalCost: number
      patentDrafts: number
      noveltySearches: number
      ideasReserved: number
      lastActivity: Date | null
    }

    const buckets = new Map<string, UserBucket>()

    const calcCost = (log: { inputTokens: number | null; outputTokens: number | null; modelClass: string | null }) => {
      const inputTokens = log.inputTokens || 0
      const outputTokens = log.outputTokens || 0
      if (log.modelClass && priceMap.has(log.modelClass)) {
        const price = priceMap.get(log.modelClass)!
        return inputTokens * (price.input / 1_000_000) + outputTokens * (price.output / 1_000_000)
      }
      return inputTokens * 0.000005 + outputTokens * 0.000015
    }

    for (const log of usageLogs) {
      if (!log.userId) continue
      if (!buckets.has(log.userId)) {
        buckets.set(log.userId, {
          userId: log.userId,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalApiCalls: 0,
          totalCost: 0,
          patentDrafts: 0,
          noveltySearches: 0,
          ideasReserved: 0,
          lastActivity: null
        })
      }
      const bucket = buckets.get(log.userId)!
      const input = log.inputTokens || 0
      const output = log.outputTokens || 0
      const calls = log.apiCalls || 0
      const cost = calcCost(log)

      bucket.totalInputTokens += input
      bucket.totalOutputTokens += output
      bucket.totalApiCalls += calls
      bucket.totalCost += cost
      if (!bucket.lastActivity || (log.startedAt && log.startedAt > bucket.lastActivity)) {
        bucket.lastActivity = log.startedAt
      }
    }

    // Domain counts
    const draftMap = new Map<string, number>()
    draftsByUser.forEach(row => draftMap.set(row.userId, row._count._all))

    const noveltyMap = new Map<string, number>()
    noveltyRuns.forEach(r => {
      const count = noveltyMap.get(r.userId) || 0
      noveltyMap.set(r.userId, count + 1)
    })

    const ideaMap = new Map<string, number>()
    reservations.forEach(r => {
      const count = ideaMap.get(r.userId) || 0
      ideaMap.set(r.userId, count + 1)
    })

    const userIds = new Set<string>()
    buckets.forEach((_, id) => userIds.add(id))
    draftMap.forEach((_, id) => userIds.add(id))
    noveltyMap.forEach((_, id) => userIds.add(id))
    ideaMap.forEach((_, id) => userIds.add(id))

    if (userIds.size === 0) {
      return NextResponse.json({
        startDate,
        endDate,
        tenantId: params.tenantId,
        users: [],
        pagination: {
          page: 1,
          pageSize: 25,
          totalUsers: 0
        }
      })
    }

    const userRecords = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, name: true, email: true }
    })

    const usersCombined = Array.from(userIds).map(id => {
      const bucket = buckets.get(id) || {
        userId: id,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0,
        lastActivity: null as Date | null
      }
      const u = userRecords.find(u => u.id === id)
      return {
        userId: id,
        userName: u?.name || u?.email || id,
        userEmail: u?.email || '',
        totalInputTokens: bucket.totalInputTokens,
        totalOutputTokens: bucket.totalOutputTokens,
        totalApiCalls: bucket.totalApiCalls,
        totalCost: bucket.totalCost,
        patentDrafts: (bucket.patentDrafts || 0) + (draftMap.get(id) || 0),
        noveltySearches: (bucket.noveltySearches || 0) + (noveltyMap.get(id) || 0),
        ideasReserved: (bucket.ideasReserved || 0) + (ideaMap.get(id) || 0),
        lastActivity: bucket.lastActivity
      }
    })

    const sortBy = parsed.sortBy || 'inputTokens'
    const sortDir = parsed.sortDir === 'asc' ? 1 : -1

    const sortedUsers = usersCombined.sort((a, b) => {
      const key = sortBy
      const getVal = (u: any) => {
        switch (key) {
          case 'userName':
            return u.userName || ''
          case 'outputTokens':
            return u.totalOutputTokens
          case 'cost':
            return u.totalCost
          case 'patentDrafts':
            return u.patentDrafts
          case 'noveltySearches':
            return u.noveltySearches
          case 'ideasReserved':
            return u.ideasReserved
          case 'inputTokens':
          default:
            return u.totalInputTokens
        }
      }

      if (key === 'userName') {
        const cmp = (getVal(a) as string).localeCompare(getVal(b) as string)
        return cmp * sortDir
      }

      const diff = (getVal(a) as number) - (getVal(b) as number)
      if (diff !== 0) return diff * sortDir
      return (a.userName || '').localeCompare(b.userName || '')
    })

    const page = parsed.page ? Math.max(1, parseInt(parsed.page, 10) || 1) : 1
    const pageSize = parsed.pageSize ? Math.max(1, parseInt(parsed.pageSize, 10) || 25) : 25
    const totalUsers = sortedUsers.length
    const startIndex = (page - 1) * pageSize
    const pageUsers = sortedUsers.slice(startIndex, startIndex + pageSize)

    return NextResponse.json({
      startDate,
      endDate,
      tenantId: params.tenantId,
      users: pageUsers,
      pagination: {
        page,
        pageSize,
        totalUsers
      }
    })
  } catch (error) {
    console.error('Admin tenant users usage API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

