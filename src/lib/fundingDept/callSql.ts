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
import { DEFAULT_TIMEZONE } from '@/lib/i18n/format'
import { deadlineDaySql, safeTimeZone } from '@/lib/i18n/sql'

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

/**
 * The zone a call's deadline day is read in: an imported call's own
 * (deadline_timezone, the funder's) when it has one, else the tenant's.
 * Curated calls never carry deadline_timezone (the existing-call backfill
 * leaves it unset), so for them this is the tenant zone, Asia/Kolkata unless
 * the tenant set another.
 */
export function callDeadlineZoneSql(alias = 'fc', timeZone: string = DEFAULT_TIMEZONE): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`COALESCE(CASE WHEN ${a}.import_run_id IS NOT NULL THEN ${a}.deadline_timezone END, ${safeTimeZone(timeZone)})`
}

/**
 * The calendar day applications close, in the call's deadline zone. A
 * curated call's stored value follows deadlineDayKey: a date-only deadline
 * (00:00 UTC) keeps its date, an instant is read as a local day. An imported call
 * publishes date-only deadlines (entry_closes_at: a letter-of-intent stage
 * closes entry first), already a calendar day: shifting a date stored at UTC
 * midnight into a western zone would move it to the day before.
 */
export function callClosingDaySql(alias = 'fc', timeZone: string = DEFAULT_TIMEZONE): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`(CASE
    WHEN ${a}.import_run_id IS NOT NULL AND COALESCE(${a}.entry_closes_at, ${a}.final_deadline_at) IS NOT NULL
      THEN COALESCE(${a}.entry_closes_at, ${a}.final_deadline_at)
    ELSE ${deadlineDaySql(Prisma.sql`COALESCE(${a}.close_date, ${a}."deadlineAt")`, callDeadlineZoneSql(alias, timeZone))}
  END)`
}

/** Today, in the call's deadline zone. */
export function callTodaySql(alias = 'fc', timeZone: string = DEFAULT_TIMEZONE): Prisma.Sql {
  return Prisma.sql`(now() AT TIME ZONE ${callDeadlineZoneSql(alias, timeZone)})::date`
}

/**
 * Still open for applications, or has no stated closing date at all. A
 * deadline stays open to the end of its local day. An imported call the
 * source has marked closed is closed whatever its dates say.
 */
export function openCallSql(alias = 'fc', timeZone: string = DEFAULT_TIMEZONE): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`(
    NOT (${a}.import_run_id IS NOT NULL AND ${a}.source_closed_at IS NOT NULL)
    AND (
      ${callClosingDaySql(alias, timeZone)} IS NULL
      OR ${callClosingDaySql(alias, timeZone)} >= ${callTodaySql(alias, timeZone)}
    )
  )`
}

/** Live obligations survive call expiry, scoped to this school's work. */
export function liveCallWorkSql(tenantId:string,schoolId:string,alias='fc'):Prisma.Sql {
  const id=Prisma.raw(`${alias}.id`)
  return Prisma.sql`(
    EXISTS(SELECT 1 FROM dsr_actions a WHERE a.tenant_id=${tenantId} AND a.school_id=${schoolId} AND a.call_id=${id} AND a.status IN ('OPEN','ACKNOWLEDGED'))
    OR EXISTS(SELECT 1 FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.school_id=${schoolId} AND a.call_id=${id}
      AND COALESCE(a.assignment_status,'') NOT IN ('DECLINED','CANCELLED','LAPSED')
      AND COALESCE(a.proposal_status,'') NOT IN ('WITHDRAWN','CLOSED','REJECTED','SANCTIONED')
      AND COALESCE(a.outcome,'') NOT IN ('AWARDED','REJECTED','WITHDRAWN'))
    OR EXISTS(SELECT 1 FROM assignment_follow_ups f JOIN tenant_org_units u ON u.id=f.org_unit_id WHERE f.tenant_id=${tenantId} AND u.path[1]=${schoolId} AND f.funding_call_id=${id} AND f.remind_at IS NOT NULL)
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

/**
 * A JS instant as a UTC `timestamp` literal, for comparing with or writing to
 * the ORM's zone-less UTC columns. A bare bound Date is read in the session time
 * zone (Asia/Kolkata on some servers), which shifts it by 5½ hours.
 */
export function utcTimestamp(value: Date | null | undefined): Prisma.Sql {
  if (!value) return Prisma.sql`NULL::timestamp`
  return Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
}
