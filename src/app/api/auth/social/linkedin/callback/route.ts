import { NextRequest, NextResponse } from 'next/server'
import { getAppOrigin, getRedirectUri, oauthConfig } from '@/lib/oauth-config'
import { clearOAuthStateCookie, verifyOAuthCallbackState } from '@/lib/oauth-state'
import { createSocialSignupToken } from '@/lib/social-signup-token'
import {
  checkSocialSignInAllowed,
  issueSocialSession,
  resolveSocialIdentity,
  type SocialIdentity
} from '@/lib/social-auth'

// Force dynamic rendering since we access search params
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const appOrigin = getAppOrigin(request.nextUrl.origin)

  const loginError = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${reason}`, appOrigin))
    clearOAuthStateCookie(response, 'linkedin')
    return response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('LinkedIn OAuth error:', error)
      return loginError('oauth_error')
    }

    if (!code) {
      return loginError('no_code')
    }

    const oauthState = verifyOAuthCallbackState(request, 'linkedin', state)
    if (!oauthState) {
      return loginError('invalid_state')
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
    const firstName = linkedinUser.given_name || ''
    const lastName = linkedinUser.family_name || ''

    const identity: SocialIdentity = {
      provider: 'linkedin',
      providerUserId: linkedinUser.sub,
      email: linkedinUser.email ?? null,
      emailVerified: linkedinUser.email_verified === true || linkedinUser.email_verified === 'true',
      name: linkedinUser.name || `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      profile: linkedinUser
    }

    const resolution = await resolveSocialIdentity(identity)

    if (resolution.kind === 'error') {
      return loginError(resolution.reason)
    }

    if (resolution.kind === 'signup') {
      // New user - redirect to registration completion with ATI token entry
      const pendingToken = createSocialSignupToken({
        provider: 'linkedin',
        providerId: identity.providerUserId,
        email: identity.email!,
        emailVerified: identity.emailVerified,
        name: identity.name,
        firstName: identity.firstName,
        lastName: identity.lastName,
        profile: linkedinUser
      })

      const completionUrl = new URL('/register/complete-social', appOrigin)
      completionUrl.searchParams.set('token', pendingToken)
      completionUrl.searchParams.set('provider', 'linkedin')
      if (oauthState.inviteToken) completionUrl.searchParams.set('invite', oauthState.inviteToken)
      const response = NextResponse.redirect(completionUrl)
      clearOAuthStateCookie(response, 'linkedin')
      return response
    }

    // Existing account - apply the same gate the password login route uses
    const blocked = checkSocialSignInAllowed(resolution.user)
    if (blocked) {
      return loginError(blocked)
    }

    const response = NextResponse.redirect(new URL('/dashboard', appOrigin))
    clearOAuthStateCookie(response, 'linkedin')
    return await issueSocialSession(response, request, resolution.user, 'linkedin')

  } catch (error) {
    console.error('LinkedIn OAuth callback error:', error)
    return loginError('oauth_callback_failed')
  }
}
