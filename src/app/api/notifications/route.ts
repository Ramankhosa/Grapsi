import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  isAccessError,
  requireTenantUser,
  TENANT_ASSIGNER_ROLES,
} from '@/lib/auth/tenantAccess'
import { createNotifications, serializeNotification } from '@/lib/notifications/notificationService'

export const dynamic = 'force-dynamic'

const sendSchema = z
  .object({
    title: z.string().trim().min(1, 'A title is required').max(200),
    body: z.string().trim().max(5000).optional().nullable(),
    linkUrl: z.string().trim().max(2000).optional().nullable(),
    userIds: z.array(z.string().trim()).max(1000).optional(),
    orgUnitIds: z.array(z.string().trim()).max(200).optional(),
    allTenantUsers: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.allTenantUsers) ||
      (value.userIds?.length || 0) > 0 ||
      (value.orgUnitIds?.length || 0) > 0,
    { message: 'Choose at least one recipient.' }
  )

/** GET — the caller's own notifications plus their unread count. */
export async function GET(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 30, 1), 100)
  const unreadOnly = searchParams.get('unreadOnly') === 'true'

  const where = {
    user_id: context.user.id,
    ...(unreadOnly ? { read_at: null } : {}),
  }

  const [records, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { created_by: { select: { id: true, name: true, email: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { user_id: context.user.id, read_at: null } }),
  ])

  return NextResponse.json({
    notifications: records.map(serializeNotification),
    unreadCount,
  })
}

/** POST — an admin sends a message to faculty (individuals, school or department). */
export async function POST(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!context.isAssigner) {
    return NextResponse.json(
      { error: `Only ${TENANT_ASSIGNER_ROLES.join(', ')} can send notifications.` },
      { status: 403 }
    )
  }

  let payload
  try {
    payload = sendSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const sent = await createNotifications({
    tenantId: context.tenantId,
    userIds: payload.userIds,
    orgUnitIds: payload.orgUnitIds,
    allTenantUsers: payload.allTenantUsers,
    title: payload.title,
    body: payload.body,
    linkUrl: payload.linkUrl,
    category: 'ANNOUNCEMENT',
    createdByUserId: context.user.id,
  })

  if (sent === 0) {
    return NextResponse.json(
      { error: 'No matching recipients in your organization.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ sent }, { status: 201 })
}
