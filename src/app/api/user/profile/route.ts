// User profile API
// Returns current user's profile information including tenant details

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

    const user = await prisma.user.findUnique({
      where: { email: payload.email },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        status: true,
        tenant: {
          select: {
            id: true,
            name: true,
            status: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)

  } catch (error) {
    console.error('User profile API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
