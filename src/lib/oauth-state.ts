import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import type { NextRequest, NextResponse } from 'next/server'

import type { OAuthProvider } from '@/lib/oauth-config'

const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET
  || process.env.JWT_SECRET
  || 'your-super-secure-jwt-secret-change-in-production-min-32-chars'

const oauthStateSchema = z.object({
  provider: z.enum(['google', 'facebook', 'linkedin', 'twitter']),
  nonce: z.string().uuid(),
  codeVerifier: z.string().min(1).optional(),
  inviteToken: z.string().min(1).optional(),
  iat: z.number(),
  exp: z.number(),
})

export type OAuthState = z.infer<typeof oauthStateSchema>

function getOAuthStateCookieName(provider: OAuthProvider): string {
  return `oauth_state_${provider}`
}

export function createOAuthState(
  provider: OAuthProvider,
  input: { codeVerifier?: string; inviteToken?: string } = {}
): string {
  return jwt.sign({
    provider,
    nonce: crypto.randomUUID(),
    ...input,
  }, OAUTH_STATE_SECRET, {
    expiresIn: '10m',
    audience: 'oauth-state',
    issuer: 'grapsi',
  })
}

export function setOAuthStateCookie(
  response: NextResponse,
  provider: OAuthProvider,
  state: string
): void {
  response.cookies.set(getOAuthStateCookieName(provider), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/api/auth/social',
  })
}

export function clearOAuthStateCookie(response: NextResponse, provider: OAuthProvider): void {
  response.cookies.delete(getOAuthStateCookieName(provider))
}

export function verifyOAuthCallbackState(
  request: NextRequest,
  provider: OAuthProvider,
  state: string | null
): OAuthState | null {
  const cookieState = request.cookies.get(getOAuthStateCookieName(provider))?.value
  if (!state || !cookieState || state.length !== cookieState.length) return null

  if (!crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) return null

  try {
    const payload = jwt.verify(state, OAUTH_STATE_SECRET, {
      audience: 'oauth-state',
      issuer: 'grapsi',
    })
    const parsed = oauthStateSchema.parse(payload)
    return parsed.provider === provider ? parsed : null
  } catch {
    return null
  }
}
