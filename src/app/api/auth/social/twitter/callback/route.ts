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
    clearOAuthStateCookie(response, 'twitter')
    return response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Twitter OAuth error:', error)
      return loginError('oauth_error')
    }

    if (!code || !state) {
      return loginError('no_code')
    }

    const oauthState = verifyOAuthCallbackState(request, 'twitter', state)
    if (!oauthState?.codeVerifier) {
      return loginError('invalid_state')
    }

    const { codeVerifier } = oauthState
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

    // Twitter doesn't provide email in the basic scope, so we synthesise a
    // placeholder. It is never verified, which keeps it from ever being
    // auto-linked onto a real account that happens to share the address.
    const email = twitterUser.username
      ? `${twitterUser.username}@twitter.local`
      : `user_${twitterUser.id}@twitter.local`

    const identity: SocialIdentity = {
      provider: 'twitter',
      providerUserId: twitterUser.id,
      email,
      emailVerified: false,
      name: twitterUser.name || twitterUser.username || 'Twitter User',
      profile: twitterData
    }

    const resolution = await resolveSocialIdentity(identity)

    if (resolution.kind === 'error') {
      return loginError(resolution.reason)
    }

    if (resolution.kind === 'signup') {
      // New user - redirect to registration completion with ATI token entry
      const pendingToken = createSocialSignupToken({
        provider: 'twitter',
        providerId: identity.providerUserId,
        email,
        emailVerified: false,
        name: identity.name,
        profile: twitterData
      })

      const completionUrl = new URL('/register/complete-social', appOrigin)
      completionUrl.searchParams.set('token', pendingToken)
      completionUrl.searchParams.set('provider', 'twitter')
      if (oauthState.inviteToken) completionUrl.searchParams.set('invite', oauthState.inviteToken)
      const response = NextResponse.redirect(completionUrl)
      clearOAuthStateCookie(response, 'twitter')
      return response
    }

    // Existing account - apply the same gate the password login route uses
    const blocked = checkSocialSignInAllowed(resolution.user)
    if (blocked) {
      return loginError(blocked)
    }

    const response = NextResponse.redirect(new URL('/dashboard', appOrigin))
    clearOAuthStateCookie(response, 'twitter')
    return await issueSocialSession(response, request, resolution.user, 'twitter')

  } catch (error) {
    console.error('Twitter OAuth callback error:', error)
    return loginError('oauth_callback_failed')
  }
}
