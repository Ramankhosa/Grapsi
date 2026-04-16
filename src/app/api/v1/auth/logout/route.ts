import { NextRequest, NextResponse } from 'next/server'
import { 
  hashRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  verifyJWT,
  createAuditLog
} from '@/lib/auth'
import { cookies } from 'next/headers'

/**
 * POST /api/v1/auth/logout
 * 
 * Logs out the user by revoking their refresh token.
 * Query params:
 *   - all=true: Revoke all sessions (logout from all devices)
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refresh_token')?.value
    const { searchParams } = new URL(request.url)
    const logoutAll = searchParams.get('all') === 'true'

    // Get user ID from access token if provided (for logout all)
    let userId: string | null = null
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7)
      const payload = verifyJWT(accessToken)
      if (payload) {
        userId = payload.sub
      }
    }

    // Revoke tokens based on mode
    if (logoutAll && userId) {
      // Logout from all devices
      await revokeAllUserTokens(userId, 'logout_all')
      
      // Audit log
      await createAuditLog({
        actorUserId: userId,
        action: 'USER_LOGOUT_ALL',
        resource: `user:${userId}`,
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        meta: { logoutAll: true }
      })
    } else if (refreshToken) {
      // Logout current session only
      const tokenHash = hashRefreshToken(refreshToken)
      await revokeRefreshToken(tokenHash, 'logout')
      
      // Audit log if we have user ID
      if (userId) {
        await createAuditLog({
          actorUserId: userId,
          action: 'USER_LOGOUT',
          resource: `user:${userId}`,
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
          meta: { logoutAll: false }
        })
      }
    }

    // Clear the refresh token cookie
    const response = NextResponse.json({ 
      success: true, 
      message: logoutAll ? 'Logged out from all devices' : 'Logged out successfully' 
    })
    
    response.cookies.set('refresh_token', '', { 
      maxAge: 0, 
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    })

    return response

  } catch (error) {
    console.error('Logout error:', error)
    // Even on error, clear the cookie
    const response = NextResponse.json(
      { success: true, message: 'Logged out' },
      { status: 200 }
    )
    response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
    return response
  }
}

