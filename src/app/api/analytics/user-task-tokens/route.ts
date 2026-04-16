import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  tenantId: z.string().optional(),
  userId: z.string().optional()
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Reuse whoami-based auth pattern from other analytics routes
    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()

    const user = await prisma.user.findUnique({
      where: { email: userData.email },
      include: { tenant: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isSuperAdmin = user.roles?.some(
      (role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
    )
    const isTenantAdmin = user.roles?.includes('ADMIN')

    if (!isSuperAdmin && !isTenantAdmin) {
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
      userId: getParam('userId')
    })

    const endDate = query.endDate ? new Date(query.endDate) : new Date()
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

    const where: any = {
      startedAt: {
        gte: startDate,
        lte: endDate
      },
      status: 'COMPLETED'
    }

    if (isSuperAdmin) {
      if (query.tenantId) {
        where.tenantId = query.tenantId
      }
    } else {
      // Tenant admin: restrict to own tenant
      where.tenantId = user.tenantId
    }

    if (query.userId) {
      where.userId = query.userId
    }

    const logs = await prisma.usageLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            tenantId: true
          }
        }
      }
    })

    const modelPrices = await prisma.lLMModelPrice.findMany()
    const priceMap = new Map<string, { input: number; output: number }>()
    for (const p of modelPrices) {
      priceMap.set(p.modelClass, {
        input: p.inputPricePerMTokens,
        output: p.outputPricePerMTokens
      })
    }

    type TaskMetrics = {
      task: string
      totalInputTokens: number
      totalOutputTokens: number
      totalApiCalls: number
      totalCost: number
      models: Array<{
        model: string
        inputTokens: number
        outputTokens: number
        cost: number
        apiCalls: number
      }>
    }

    type UserMetrics = {
      userId: string
      userName: string
      userEmail: string
      totalInputTokens: number
      totalOutputTokens: number
      totalApiCalls: number
      totalCost: number
      tasks: TaskMetrics[]
    }

    const usersMap = new Map<string, UserMetrics>()

    for (const log of logs) {
      if (!log.userId || !log.user) continue

      const uid = log.userId
      if (!usersMap.has(uid)) {
        usersMap.set(uid, {
          userId: uid,
          userName: log.user.name || log.user.email,
          userEmail: log.user.email,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalApiCalls: 0,
          totalCost: 0,
          tasks: []
        })
      }

      const userEntry = usersMap.get(uid)!
      const input = log.inputTokens || 0
      const output = log.outputTokens || 0
      const calls = log.apiCalls || 1

      const modelKey = log.modelClass || 'UNKNOWN_MODEL'
      let unitPrices = priceMap.get(modelKey)
      if (!unitPrices) {
        unitPrices = { input: 0.000005, output: 0.000015 }
      }
      const cost =
        input * (unitPrices.input / 1_000_000) + output * (unitPrices.output / 1_000_000)

      userEntry.totalInputTokens += input
      userEntry.totalOutputTokens += output
      userEntry.totalApiCalls += calls
      userEntry.totalCost += cost

      const taskKey = log.taskCode || 'UNKNOWN_TASK'
      let taskEntry = userEntry.tasks.find(t => t.task === taskKey)
      if (!taskEntry) {
        taskEntry = {
          task: taskKey,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalApiCalls: 0,
          totalCost: 0,
          models: []
        }
        userEntry.tasks.push(taskEntry)
      }

      taskEntry.totalInputTokens += input
      taskEntry.totalOutputTokens += output
      taskEntry.totalApiCalls += calls
      taskEntry.totalCost += cost

      let modelEntry = taskEntry.models.find(m => m.model === modelKey)
      if (!modelEntry) {
        modelEntry = {
          model: modelKey,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          apiCalls: 0
        }
        taskEntry.models.push(modelEntry)
      }

      modelEntry.inputTokens += input
      modelEntry.outputTokens += output
      modelEntry.cost += cost
      modelEntry.apiCalls += calls
    }

    const users = Array.from(usersMap.values()).sort(
      (a, b) => b.totalInputTokens + b.totalOutputTokens - (a.totalInputTokens + a.totalOutputTokens)
    )

    return NextResponse.json({
      startDate,
      endDate,
      tenantId: query.tenantId || (isTenantAdmin ? user.tenantId : null),
      users
    })
  } catch (error) {
    console.error('User task tokens analytics error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
