import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashToken } from '@/lib/token-utils'

// Force dynamic rendering since this route accesses request.url
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('token') || ''
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    const tokenHash = hashToken(token)
    const rec = await prisma.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }
    })
    if (!rec) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 })

    await prisma.$transaction([
      prisma.user.update({ where: { id: rec.userId }, data: { emailVerified: true } }),
      prisma.emailVerificationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } })
    ])

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Verify email error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

