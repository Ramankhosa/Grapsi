import { NextRequest, NextResponse } from 'next/server'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '@/lib/prisma'
import { generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'
import { getAppOrigin, getRedirectUri, oauthConfig } from '@/lib/oauth-config'

// Force dynamic rendering since we access search params
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const appOrigin = getAppOrigin(request.nextUrl.origin)
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(
        new URL('/login?error=oauth_error', appOrigin)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/login?error=no_code', appOrigin)
      )
    }

    const redirectUri = getRedirectUri('google', request.nextUrl.origin)

    // Initialize Google OAuth client
    const oauth2Client = new OAuth2Client(
      oauthConfig.google.clientId,
      oauthConfig.google.clientSecret,
      redirectUri
    )

    // Exchange authorization code for access token
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get user info from Google
    const userInfoResponse = await fetch(oauthConfig.google.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    })

    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch Google user info')
    }

    const googleUser = await userInfoResponse.json()

    // Check if user already exists with this Google account
    let user = await prisma.user.findFirst({
      where: {
        oauthProvider: 'GOOGLE',
        oauthProviderId: googleUser.id
      },
      include: { tenant: true }
    })

    if (!user) {
      // Check if user exists with same email
      const existingUser = await prisma.user.findUnique({
        where: { email: googleUser.email },
        include: { tenant: true }
      })

      if (existingUser) {
        // Link existing account with Google OAuth
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            oauthProvider: 'GOOGLE',
            oauthProviderId: googleUser.id,
            oauthProfile: googleUser,
            emailVerified: true
          },
          include: { tenant: true }
        })
      } else {
        // New user - redirect to registration completion with ATI token entry
        // Create a pending registration token with user data
        const pendingData = {
          provider: 'google',
          providerId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          firstName: googleUser.given_name,
          lastName: googleUser.family_name,
          profile: googleUser,
          exp: Date.now() + 15 * 60 * 1000 // 15 minutes expiry
        }

        const pendingToken = Buffer.from(JSON.stringify(pendingData)).toString('base64url')

        return NextResponse.redirect(
          new URL(`/register/complete-social?token=${pendingToken}&provider=google`, appOrigin)
        )
      }
    }

    // User exists - proceed with login
    // Generate JWT token
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null,
      scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
    })

    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    // Generate and store refresh token
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: ip
    })

    // Audit log
    await createAuditLog({
      actorUserId: user.id,
      tenantId: user.tenantId || undefined,
      action: 'USER_LOGIN',
      resource: `user:${user.id}`,
      ip,
      meta: {
        email: user.email,
        roles: user.roles,
        login_method: 'google_oauth',
        oauth_provider: 'GOOGLE'
      }
    })

    // Create response with access token
    const response = NextResponse.redirect(
      new URL('/dashboard', appOrigin)
    )

    // Set refresh token as httpOnly cookie
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })

    // Set access token cookie
    response.cookies.set('access_token', accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
      path: '/'
    })

    return response

  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return NextResponse.redirect(
      new URL('/login?error=oauth_callback_failed', getAppOrigin(request.nextUrl.origin))
    )
  }
}
