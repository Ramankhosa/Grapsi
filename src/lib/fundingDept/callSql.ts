/**
 * The two raw-SQL fragments every department read needs, in one place.
 *
 * Both were private copies in `schoolFunnelService` and `accountabilityService`.
 * That was harmless while there were two readers and actively dangerous once
 * there were five: a visibility rule that differs between the grid and the
 * report behind it means one of them is showing a call the other says does not
 * exist, and there is no way to tell which from the screen.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

/** A bound `text[]` literal. Empty arrays are the caller problem, not this one. */
export function textArray(values: string[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`ARRAY[]::text[]`
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`
}

/**
 * Calls this tenant may work on: its own published catalog plus the global one.
 *
 * Drafts are excluded deliberately. The department can only delegate a call the
 * assignee is able to open, and a researcher read path shows published calls
 * only, so counting a draft as pendency would create a backlog nobody could
 * clear.
 */
export function visibleCallSql(tenantId: string, alias = 'fc'): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`(
    (${a}."tenantId" = ${tenantId} AND (${a}.status = 'PUBLISHED' OR ${a}.catalog_status = 'PUBLISHED'))
    OR (${a}."tenantId" IS NULL AND ${a}.visibility = 'GLOBAL_PUBLISHED' AND ${a}.status = 'PUBLISHED')
  )`
}

/** Still open for applications, or has no stated closing date at all. */
export function openCallSql(alias = 'fc'): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`(
    COALESCE(${a}.close_date, ${a}."deadlineAt") IS NULL
    OR COALESCE(${a}.close_date, ${a}."deadlineAt") >= now()
  )`
}

/**
 * When a call entered the system, which is what every age in this module counts
 * from.
 *
 * Falls back through published to created because an imported call may never
 * have been published as such, and a null age would read as "brand new" — the
 * one answer that would hide the oldest backlog in the catalog.
 */
export function callEnteredAtSql(alias = 'fc'): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`COALESCE(${a}."publishedAt", ${a}."createdAt")`
}

/** Every active unit at or beneath these roots, via the materialised path. */
export async function subtreeUnitIds(tenantId: string, rootIds: string[]): Promise<string[]> {
  if (rootIds.length === 0) return []
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM tenant_org_units
     WHERE tenant_id = ${tenantId} AND is_active = true AND path && ${textArray(rootIds)}
  `)
  return rows.length > 0 ? rows.map((row) => row.id) : rootIds
}
