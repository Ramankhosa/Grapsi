import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'
import { serializeNotification } from '@/lib/notifications/notificationService'

export const dynamic = 'force-dynamic'

/** PATCH — mark one notification read/unread. Recipient only. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  // Scoped by user_id so one user can never touch another's notification.
  const existing = await prisma.notification.findFirst({
    where: { id: params.id, user_id: context.user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Notification not found.' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const read = body?.read !== false

  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: { read_at: read ? new Date() : null },
    include: { created_by: { select: { id: true, name: true, email: true } } },
  })

  return NextResponse.json({ notification: serializeNotification(updated) })
}

/** DELETE — dismiss one of the caller's own notifications. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const result = await prisma.notification.deleteMany({
    where: { id: params.id, user_id: context.user.id },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Notification not found.' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
