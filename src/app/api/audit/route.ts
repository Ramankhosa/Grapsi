import { NextRequest, NextResponse } from 'next/server'

import {
  isAuditAccessError,
  requireAuditViewer,
  resolveAuditTenantFilter,
} from '@/lib/audit/access'
import {
  AUDIT_GROUPS,
  AUDIT_GROUP_COPY,
  DEFAULT_GROUPS,
  actionLabel,
  actionsInGroups,
  groupForAction,
  parseResource,
  type AuditGroup,
} from '@/lib/audit/actions'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * The audit trail, read back.
 *
 * Around thirty call sites have been writing these rows since the product
 * started and nothing has ever displayed them, so no administrator could answer
 * "who changed this role, and when". The rows were always there; this is the
 * reader.
 *
 * Defaults to the governance groups rather than everything. The log also holds
 * routine product activity — sections generated, searches run — and a first
 * screen full of that is a screen nobody comes back to. `groups=all` opens it up.
 */

const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export async function GET(request: NextRequest) {
  const viewer = await requireAuditViewer(request)
  if (isAuditAccessError(viewer)) return viewer.response

  const params = request.nextUrl.searchParams

  // The tenant is taken from the session for a tenant viewer, so a supplied
  // tenantId can only ever narrow a platform viewer, never widen anyone.
  const tenantId = resolveAuditTenantFilter(viewer.scope, params.get('tenantId'))

  const requestedGroups = (params.get('groups') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const groups: AuditGroup[] = requestedGroups.includes('all')
    ? [...AUDIT_GROUPS]
    : (requestedGroups.filter((value) =>
        (AUDIT_GROUPS as readonly string[]).includes(value)
      ) as AuditGroup[])
  const effectiveGroups = groups.length > 0 ? groups : [...DEFAULT_GROUPS]

  const action = (params.get('action') || '').trim()
  const actorUserId = (params.get('actorUserId') || '').trim()
  const search = (params.get('q') || '').trim()
  const from = params.get('from')
  const to = params.get('to')
  const cursor = params.get('cursor')

  const limit = Math.min(
    Math.max(Number(params.get('limit')) || PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  )

  const where: any = {}
  if (tenantId) where.tenantId = tenantId
  if (actorUserId) where.actorUserId = actorUserId

  if (action) {
    where.action = action
  } else if (!requestedGroups.includes('all')) {
    // A group filter is expressed as a list of action strings rather than a
    // computed prefix, because the prefixes genuinely overlap: USER_LOGIN and
    // USER_ROLE_CHANGE share one and belong in different groups.
    where.action = { in: actionsInGroups(effectiveGroups) }
  }

  // `resource` is a free-text "kind:id" string, so a contains match is the
  // honest way to find everything touching one object.
  if (search) where.resource = { contains: search, mode: 'insensitive' }

  const createdAt: Record<string, Date> = {}
  if (from && !Number.isNaN(Date.parse(from))) createdAt.gte = new Date(from)
  if (to && !Number.isNaN(Date.parse(to))) createdAt.lte = new Date(to)
  if (cursor && !Number.isNaN(Date.parse(cursor))) {
    // Keyset pagination on the same column the index ends with. An id tiebreak
    // is deliberately skipped: two rows sharing a millisecond is rare enough
    // that repeating one is a better trade than a compound cursor.
    createdAt.lt = new Date(cursor)
  }
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      action: true,
      resource: true,
      ip: true,
      meta: true,
      createdAt: true,
      tenantId: true,
      actor: { select: { id: true, name: true, email: true } },
      tenant: { select: { id: true, name: true } },
    },
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  return NextResponse.json({
    scope: viewer.scope.kind,
    groups: effectiveGroups,
    // The screen's vocabulary travels with the data, the way the other settings
    // endpoints do, so the labels and the rules cannot drift apart.
    groupOptions: AUDIT_GROUPS.map((key) => ({ key, ...AUDIT_GROUP_COPY[key] })),
    defaultGroups: DEFAULT_GROUPS,
    entries: page.map((row) => ({
      id: row.id,
      action: row.action,
      actionLabel: actionLabel(row.action),
      group: groupForAction(row.action),
      resource: parseResource(row.resource),
      ip: row.ip,
      meta: row.meta,
      at: row.createdAt,
      actor: row.actor
        ? { id: row.actor.id, name: row.actor.name, email: row.actor.email }
        : null,
      tenant: row.tenant ? { id: row.tenant.id, name: row.tenant.name } : null,
    })),
    // The cursor is the last row's timestamp, which is what the `lt` above takes.
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  })
}
