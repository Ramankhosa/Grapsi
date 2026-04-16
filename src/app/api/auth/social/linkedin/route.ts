import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationUrl, validateOAuthConfig } from '@/lib/oauth-config'

// Force dynamic rendering since we access request.nextUrl.origin
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Validate OAuth configuration
    if (!validateOAuthConfig('linkedin')) {
      return NextResponse.json(
        { code: 'OAUTH_CONFIG_MISSING', message: 'LinkedIn OAuth configuration is missing' },
        { status: 500 }
      )
    }

    // Generate state parameter for CSRF protection
    const state = crypto.randomUUID()

    // Generate authorization URL
    const authUrl = getAuthorizationUrl('linkedin', state, request.nextUrl.origin)

    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('LinkedIn OAuth initiation error:', error)
    return NextResponse.json(
      { code: 'OAUTH_INIT_ERROR', message: 'Failed to initiate LinkedIn OAuth' },
      { status: 500 }
    )
  }
}
