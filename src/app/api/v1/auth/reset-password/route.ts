import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
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
      prisma.user.update({ where: { id: rec.userId }, data: { passwordHash: newHash } }),
      prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } })
    ])

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Reset password error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

