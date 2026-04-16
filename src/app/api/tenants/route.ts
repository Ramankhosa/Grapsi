// Tenants API for Super Admin dashboard
// Lists all tenants for analytics filtering

import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for API routes that use headers
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    // Custom authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify JWT directly
    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 })
    }

    // Only super admins and super admin viewers can access this endpoint
    if (!payload.roles?.some((role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Fetch all active tenants with basic info
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        name: true,
        atiId: true,
        createdAt: true,
        _count: {
          select: {
            users: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    })

    // Format response
    const formattedTenants = tenants.map(tenant => ({
      id: tenant.id,
      name: tenant.name,
      atiId: tenant.atiId,
      userCount: tenant._count.users,
      createdAt: tenant.createdAt
    }))

    return NextResponse.json(formattedTenants)

  } catch (error) {
    console.error('Tenants API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
