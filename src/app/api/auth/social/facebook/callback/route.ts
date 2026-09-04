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
    clearOAuthStateCookie(response, 'facebook')
    return response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Facebook OAuth error:', error)
      return loginError('oauth_error')
    }

    if (!code) {
      return loginError('no_code')
    }

    const oauthState = verifyOAuthCallbackState(request, 'facebook', state)
    if (!oauthState) {
      return loginError('invalid_state')
    }

    const redirectUri = getRedirectUri('facebook', request.nextUrl.origin)

    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      client_id: oauthConfig.facebook.clientId!,
      client_secret: oauthConfig.facebook.clientSecret!,
      redirect_uri: redirectUri,
      code: code
    })

    const tokenResponse = await fetch(`${oauthConfig.facebook.tokenUrl}?${tokenParams.toString()}`, {
      method: 'GET'
    })

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for access token')
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // Get user info from Facebook
    const userInfoResponse = await fetch(oauthConfig.facebook.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch Facebook user info')
    }

    const facebookUser = await userInfoResponse.json()

    const identity: SocialIdentity = {
      provider: 'facebook',
      providerUserId: facebookUser.id,
      email: facebookUser.email ?? null,
      // Facebook only returns an email once the account holder has confirmed
      // it, so its presence is the verification signal.
      emailVerified: !!facebookUser.email,
      name: facebookUser.name,
      firstName: facebookUser.first_name,
      lastName: facebookUser.last_name,
      profile: facebookUser
    }

    const resolution = await resolveSocialIdentity(identity)

    if (resolution.kind === 'error') {
      return loginError(resolution.reason)
    }

    if (resolution.kind === 'signup') {
      // New user - redirect to registration completion with ATI token entry
      const pendingToken = createSocialSignupToken({
        provider: 'facebook',
        providerId: identity.providerUserId,
        email: identity.email!,
        emailVerified: identity.emailVerified,
        name: identity.name,
        firstName: identity.firstName,
        lastName: identity.lastName,
        profile: facebookUser
      })

      const completionUrl = new URL('/register/complete-social', appOrigin)
      completionUrl.searchParams.set('token', pendingToken)
      completionUrl.searchParams.set('provider', 'facebook')
      if (oauthState.inviteToken) completionUrl.searchParams.set('invite', oauthState.inviteToken)
      const response = NextResponse.redirect(completionUrl)
      clearOAuthStateCookie(response, 'facebook')
      return response
    }

    // Existing account - apply the same gate the password login route uses
    const blocked = checkSocialSignInAllowed(resolution.user)
    if (blocked) {
      return loginError(blocked)
    }

    const response = NextResponse.redirect(new URL('/dashboard', appOrigin))
    clearOAuthStateCookie(response, 'facebook')
    return await issueSocialSession(response, request, resolution.user, 'facebook')

  } catch (error) {
    console.error('Facebook OAuth callback error:', error)
    return loginError('oauth_callback_failed')
  }
}
