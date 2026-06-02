import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationUrl, validateOAuthConfig } from '@/lib/oauth-config'
import { createOAuthState, setOAuthStateCookie } from '@/lib/oauth-state'

export async function GET(request: NextRequest) {
  try {
    // Validate OAuth configuration
    if (!validateOAuthConfig('facebook')) {
      return NextResponse.json(
        { code: 'OAUTH_CONFIG_MISSING', message: 'Facebook OAuth configuration is missing' },
        { status: 500 }
      )
    }

    // Generate state parameter for CSRF protection
    const state = createOAuthState('facebook', {
      inviteToken: request.nextUrl.searchParams.get('invite') || undefined,
    })

    // Generate authorization URL
    const authUrl = getAuthorizationUrl('facebook', state, request.nextUrl.origin)

    const response = NextResponse.redirect(authUrl)
    setOAuthStateCookie(response, 'facebook', state)
    return response
  } catch (error) {
    console.error('Facebook OAuth initiation error:', error)
    return NextResponse.json(
      { code: 'OAUTH_INIT_ERROR', message: 'Failed to initiate Facebook OAuth' },
      { status: 500 }
    )
  }
}
