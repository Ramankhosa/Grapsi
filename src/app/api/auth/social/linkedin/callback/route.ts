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
      console.error('LinkedIn OAuth error:', error)
      return NextResponse.redirect(
        new URL('/login?error=oauth_error', appOrigin)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/login?error=no_code', appOrigin)
      )
    }

    const redirectUri = getRedirectUri('linkedin', request.nextUrl.origin)

    // Exchange authorization code for access token
    const tokenResponse = await fetch(oauthConfig.linkedin.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: oauthConfig.linkedin.clientId!,
        client_secret: oauthConfig.linkedin.clientSecret!
      })
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('LinkedIn token exchange failed:', tokenResponse.status, errorText)
      throw new Error(`Failed to exchange code for access token: ${tokenResponse.status} ${errorText}`)
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // Get user info from LinkedIn using OpenID Connect userinfo endpoint
    const userInfoResponse = await fetch(oauthConfig.linkedin.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text()
      console.error('LinkedIn user info fetch failed:', userInfoResponse.status, errorText)
      throw new Error(`Failed to fetch LinkedIn user info: ${userInfoResponse.status} ${errorText}`)
    }

    const linkedinUser = await userInfoResponse.json()

    // LinkedIn OpenID Connect response format:
    // { sub, name, given_name, family_name, picture, locale, email, email_verified }
    const profileId = linkedinUser.sub
    const firstName = linkedinUser.given_name || ''
    const lastName = linkedinUser.family_name || ''
    const email = linkedinUser.email || ''

    // Check if user already exists with this LinkedIn account
    let user = await prisma.user.findFirst({
      where: {
        oauthProvider: 'LINKEDIN',
        oauthProviderId: profileId
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
        // Link existing account with LinkedIn OAuth
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            oauthProvider: 'LINKEDIN',
            oauthProviderId: profileId,
            oauthProfile: linkedinUser,
            emailVerified: true
          },
          include: { tenant: true }
        })
      } else {
        // New user - redirect to registration completion with ATI token entry
        const pendingData = {
          provider: 'linkedin',
          providerId: profileId,
          email: email,
          name: `${firstName} ${lastName}`.trim(),
          firstName: firstName,
          lastName: lastName,
          profile: linkedinUser,
          exp: Date.now() + 15 * 60 * 1000
        }

        const pendingToken = Buffer.from(JSON.stringify(pendingData)).toString('base64url')

        return NextResponse.redirect(
          new URL(`/register/complete-social?token=${pendingToken}&provider=linkedin`, appOrigin)
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
        login_method: 'linkedin_oauth',
        oauth_provider: 'LINKEDIN'
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
    console.error('LinkedIn OAuth callback error:', error)
    return NextResponse.redirect(
      new URL('/login?error=oauth_callback_failed', getAppOrigin(request.nextUrl.origin))
    )
  }
}
