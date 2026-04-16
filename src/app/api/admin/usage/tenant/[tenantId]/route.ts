import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computeUsageSummary } from '@/lib/admin-usage-service'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional()
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
      endDate: getParam('endDate')
    })

    const endDate = parsed.endDate ? new Date(parsed.endDate) : new Date()
    const startDate = parsed.startDate ? new Date(parsed.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

    const usage = await computeUsageSummary(startDate, endDate, params.tenantId)

    const tenant = usage.tenants.find(t => t.tenantId === params.tenantId || (!t.tenantId && params.tenantId === 'no-tenant'))

    return NextResponse.json({
      startDate: usage.startDate,
      endDate: usage.endDate,
      tenant
    })
  } catch (error) {
    console.error('Admin tenant usage API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

