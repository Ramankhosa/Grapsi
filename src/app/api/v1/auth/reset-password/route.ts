import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, revokeAllUserTokens } from '@/lib/auth'
import { hashToken } from '@/lib/token-utils'

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()
    if (!token || typeof token !== 'string' || !password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Invalid token or password' }, { status: 400 })
    }
    const tokenHash = hashToken(token)
    const rec = await prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }
    })
    if (!rec) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 })
    }

    const newHash = await hashPassword(password)
    await prisma.$transaction([
      prisma.user.update({
        where: { id: rec.userId },
        // Clearing mustChangePassword is what ends a forced change: this route
        // is the only way out of one, so the flag and the new password have to
        // land together.
        data: { passwordHash: newHash, mustChangePassword: false, passwordChangedAt: new Date() }
      }),
      prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } })
    ])

    // Whoever held a session before the reset should not keep it — the usual
    // reason somebody resets a password is that they think another person has
    // it.
    await revokeAllUserTokens(rec.userId, 'password_reset')

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Reset password error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

