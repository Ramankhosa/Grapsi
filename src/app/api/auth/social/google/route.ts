import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationUrl, validateOAuthConfig } from '@/lib/oauth-config'

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
    const state = crypto.randomUUID()

    // Generate authorization URL
    const authUrl = getAuthorizationUrl('google', state, request.nextUrl.origin)

    // Store state in session for verification (in production, use secure session store)
    // For now, we'll handle this in the callback

    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Google OAuth initiation error:', error)
    return NextResponse.json(
      { code: 'OAUTH_INIT_ERROR', message: 'Failed to initiate Google OAuth' },
      { status: 500 }
    )
  }
}
