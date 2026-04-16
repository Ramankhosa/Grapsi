import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computeUsageSummary } from '@/lib/admin-usage-service'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sortBy: z
    .enum(['tenantName', 'inputTokens', 'outputTokens', 'cost', 'patentDrafts', 'noveltySearches', 'ideasReserved'])
    .optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify token via whoami
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

    const userRoles: string[] = Array.isArray(userData.roles) ? userData.roles : []
    const isSuperAdmin = userRoles.some((r: string) => r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN_VIEWER')
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

    const usage = await computeUsageSummary(startDate, endDate)

    const sortBy = parsed.sortBy || 'inputTokens'
    const sortDir = parsed.sortDir === 'asc' ? 1 : -1

    const sortedTenants = [...usage.tenants].sort((a, b) => {
      const key = sortBy
      const getVal = (t: any) => {
        switch (key) {
          case 'tenantName':
            return t.tenantName || ''
          case 'outputTokens':
            return t.totalOutputTokens
          case 'cost':
            return t.totalCost
          case 'patentDrafts':
            return t.patentDrafts
          case 'noveltySearches':
            return t.noveltySearches
          case 'ideasReserved':
            return t.ideasReserved
          case 'inputTokens':
          default:
            return t.totalInputTokens
        }
      }

      if (key === 'tenantName') {
        const cmp = (getVal(a) as string).localeCompare(getVal(b) as string)
        if (cmp !== 0) return cmp * sortDir
        return 0
      }

      const diff = (getVal(a) as number) - (getVal(b) as number)
      if (diff !== 0) return diff * sortDir
      // Fallback by name for stable ordering
      return (a.tenantName || '').localeCompare(b.tenantName || '')
    })

    const page = parsed.page ? Math.max(1, parseInt(parsed.page, 10) || 1) : 1
    const pageSize = parsed.pageSize ? Math.max(1, parseInt(parsed.pageSize, 10) || 25) : 25
    const totalTenants = sortedTenants.length
    const startIndex = (page - 1) * pageSize
    const pageTenants = sortedTenants.slice(startIndex, startIndex + pageSize)

    return NextResponse.json({
      startDate: usage.startDate,
      endDate: usage.endDate,
      summary: usage.global,
      tenants: pageTenants,
      pagination: {
        page,
        pageSize,
        totalTenants
      }
    })
  } catch (error) {
    console.error('Admin usage summary API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
