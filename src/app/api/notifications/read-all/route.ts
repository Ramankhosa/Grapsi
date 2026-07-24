import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'

export const dynamic = 'force-dynamic'

/** POST — mark every unread notification for the caller as read. */
export async function POST(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const result = await prisma.notification.updateMany({
    where: { user_id: context.user.id, read_at: null },
    data: { read_at: new Date() },
  })

  return NextResponse.json({ updated: result.count })
}
