import { NextRequest, NextResponse } from 'next/server'
import { OAuth2Client } from 'google-auth-library'
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
    clearOAuthStateCookie(response, 'google')
    return response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Google OAuth error:', error)
      return loginError('oauth_error')
    }

    if (!code) {
      return loginError('no_code')
    }

    const oauthState = verifyOAuthCallbackState(request, 'google', state)
    if (!oauthState) {
      return loginError('invalid_state')
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

    const identity: SocialIdentity = {
      provider: 'google',
      providerUserId: googleUser.id,
      email: googleUser.email ?? null,
      // Google userinfo v2 reports this as `verified_email`; id_token payloads
      // use `email_verified`. Accept either.
      emailVerified: googleUser.verified_email === true || googleUser.email_verified === true,
      name: googleUser.name,
      firstName: googleUser.given_name,
      lastName: googleUser.family_name,
      profile: googleUser
    }

    const resolution = await resolveSocialIdentity(identity)

    if (resolution.kind === 'error') {
      return loginError(resolution.reason)
    }

    if (resolution.kind === 'signup') {
      // New user - redirect to registration completion with ATI token entry
      const pendingToken = createSocialSignupToken({
        provider: 'google',
        providerId: identity.providerUserId,
        email: identity.email!,
        emailVerified: identity.emailVerified,
        name: identity.name,
        firstName: identity.firstName,
        lastName: identity.lastName,
        profile: googleUser
      })

      const completionUrl = new URL('/register/complete-social', appOrigin)
      completionUrl.searchParams.set('token', pendingToken)
      completionUrl.searchParams.set('provider', 'google')
      if (oauthState.inviteToken) completionUrl.searchParams.set('invite', oauthState.inviteToken)
      const response = NextResponse.redirect(completionUrl)
      clearOAuthStateCookie(response, 'google')
      return response
    }

    // Existing account - apply the same gate the password login route uses
    const blocked = checkSocialSignInAllowed(resolution.user)
    if (blocked) {
      return loginError(blocked)
    }

    const response = NextResponse.redirect(new URL('/dashboard', appOrigin))
    clearOAuthStateCookie(response, 'google')
    return await issueSocialSession(response, request, resolution.user, 'google')

  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return loginError('oauth_callback_failed')
  }
}
