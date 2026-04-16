import { NextRequest, NextResponse } from 'next/server'
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
      console.error('Twitter OAuth error:', error)
      return NextResponse.redirect(
        new URL('/login?error=oauth_error', appOrigin)
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/login?error=no_code', appOrigin)
      )
    }

    // Decode state parameter to get PKCE verifier
    let decodedState
    try {
      decodedState = JSON.parse(Buffer.from(state, 'base64url').toString())
    } catch (e) {
      return NextResponse.redirect(
        new URL('/login?error=invalid_state', appOrigin)
      )
    }

    const { codeVerifier } = decodedState
    const redirectUri = getRedirectUri('twitter', request.nextUrl.origin)

    // Exchange authorization code for access token using PKCE
    const tokenResponse = await fetch(oauthConfig.twitter.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${oauthConfig.twitter.clientId}:${oauthConfig.twitter.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error('Twitter token exchange failed:', errorData)
      throw new Error('Failed to exchange code for access token')
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // Get user info from Twitter
    const userInfoResponse = await fetch(oauthConfig.twitter.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch Twitter user info')
    }

    const twitterData = await userInfoResponse.json()
    const twitterUser = twitterData.data

    // Twitter doesn't provide email in the basic scope
    const email = twitterUser.username ? `${twitterUser.username}@twitter.local` : `user_${twitterUser.id}@twitter.local`
    const name = twitterUser.name || twitterUser.username || 'Twitter User'

    // Check if user already exists with this Twitter account
    let user = await prisma.user.findFirst({
      where: {
        oauthProvider: 'TWITTER',
        oauthProviderId: twitterUser.id
      },
      include: { tenant: true }
    })

    if (!user) {
      // Check if user exists with same email
      const existingUser = await prisma.user.findUnique({
        where: { email: email },
        include: { tenant: true }
      })

      if (existingUser) {
        // Link existing account with Twitter OAuth
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            oauthProvider: 'TWITTER',
            oauthProviderId: twitterUser.id,
            oauthProfile: twitterData,
            emailVerified: true
          },
          include: { tenant: true }
        })
      } else {
        // New user - redirect to registration completion with ATI token entry
        const pendingData = {
          provider: 'twitter',
          providerId: twitterUser.id,
          email: email,
          name: name,
          profile: twitterData,
          exp: Date.now() + 15 * 60 * 1000
        }

        const pendingToken = Buffer.from(JSON.stringify(pendingData)).toString('base64url')

        return NextResponse.redirect(
          new URL(`/register/complete-social?token=${pendingToken}&provider=twitter`, appOrigin)
        )
      }
    }

    // User exists - proceed with login
    const accessTokenJWT = generateJWT({
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
        login_method: 'twitter_oauth',
        oauth_provider: 'TWITTER'
      }
    })

    // Create response
    const response = NextResponse.redirect(
      new URL('/dashboard', appOrigin)
    )

    // Set tokens as cookies
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })

    response.cookies.set('access_token', accessTokenJWT, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
      path: '/'
    })

    return response

  } catch (error) {
    console.error('Twitter OAuth callback error:', error)
    return NextResponse.redirect(
      new URL('/login?error=oauth_callback_failed', getAppOrigin(request.nextUrl.origin))
    )
  }
}
