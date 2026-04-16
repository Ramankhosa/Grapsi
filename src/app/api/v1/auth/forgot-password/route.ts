import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail } from '@/lib/mailer'
import { resetTemplate } from '@/lib/email-templates'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    // Always respond with success to avoid account enumeration
    if (!user) return NextResponse.json({ success: true })

    // Invalidate prior tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    })

    const raw = generateToken()
    const tokenHash = hashToken(raw)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } })

    const displayName = (user?.firstName || user?.lastName) ? `${user?.firstName || ''} ${user?.lastName || ''}`.trim() : (user?.name || undefined)
    const tpl = resetTemplate(email, displayName, raw)
    await sendEmail({ to: email, toName: displayName, subject: tpl.subject, html: tpl.html, text: tpl.text })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Forgot password error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
