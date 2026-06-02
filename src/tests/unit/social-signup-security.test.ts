import { describe, expect, it } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

import { createOAuthState, setOAuthStateCookie, verifyOAuthCallbackState } from '@/lib/oauth-state'
import { createSocialSignupToken, verifySocialSignupToken } from '@/lib/social-signup-token'

function tamperSignature(token: string): string {
  const parts = token.split('.')
  const signature = parts[2]
  parts[2] = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`
  return parts.join('.')
}

describe('social signup security tokens', () => {
  it('rejects a tampered pending social signup token', () => {
    const token = createSocialSignupToken({
      provider: 'google',
      providerId: 'google-user-1',
      email: 'person@example.com',
    })

    expect(verifySocialSignupToken(token).email).toBe('person@example.com')
    expect(() => verifySocialSignupToken(tamperSignature(token))).toThrow()
  })

  it('accepts OAuth state only when it matches the callback cookie and provider', () => {
    const state = createOAuthState('google', { inviteToken: 'ati-invite' })
    const response = NextResponse.next()
    setOAuthStateCookie(response, 'google', state)
    const cookie = response.cookies.get('oauth_state_google')?.value
    const request = new NextRequest('http://localhost/api/auth/social/google/callback', {
      headers: { cookie: `oauth_state_google=${cookie}` },
    })

    expect(verifyOAuthCallbackState(request, 'google', state)?.inviteToken).toBe('ati-invite')
    expect(verifyOAuthCallbackState(request, 'linkedin', state)).toBeNull()
    expect(verifyOAuthCallbackState(request, 'google', tamperSignature(state))).toBeNull()
  })
})
