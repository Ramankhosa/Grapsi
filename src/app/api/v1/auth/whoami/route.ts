import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { code: 'NO_TOKEN', message: 'Authorization token required' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    // Verify JWT
    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json(
        { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Check if token is expired (jwt.verify should handle this, but double-check)
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      return NextResponse.json(
        { code: 'EXPIRED_TOKEN', message: 'Token has expired' },
        { status: 401 }
      )
    }

    // Return user info from JWT claims (no database hit for performance)
    return NextResponse.json({
      user_id: payload.sub,
      email: payload.email,
      tenant_id: payload.tenant_id,
      roles: payload.roles,
      ati_id: payload.ati_id
    }, { status: 200 })

  } catch (error) {
    console.error('Whoami error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
