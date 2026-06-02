import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationUrl, validateOAuthConfig } from '@/lib/oauth-config'
import { createOAuthState, setOAuthStateCookie } from '@/lib/oauth-state'

// Force dynamic rendering since we access request.nextUrl.origin
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Validate OAuth configuration
    if (!validateOAuthConfig('google')) {
      return NextResponse.json(
        { code: 'OAUTH_CONFIG_MISSING', message: 'Google OAuth configuration is missing' },
        { status: 500 }
      )
    }

    // Generate state parameter for CSRF protection
    const state = createOAuthState('google', {
      inviteToken: request.nextUrl.searchParams.get('invite') || undefined,
    })

    // Generate authorization URL
    const authUrl = getAuthorizationUrl('google', state, request.nextUrl.origin)

    // Store state in session for verification (in production, use secure session store)
    // For now, we'll handle this in the callback

    const response = NextResponse.redirect(authUrl)
    setOAuthStateCookie(response, 'google', state)
    return response
  } catch (error) {
    console.error('Google OAuth initiation error:', error)
    return NextResponse.json(
      { code: 'OAUTH_INIT_ERROR', message: 'Failed to initiate Google OAuth' },
      { status: 500 }
    )
  }
}
