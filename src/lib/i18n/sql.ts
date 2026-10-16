/**
 * Time-zone-aware SQL fragments. Stored instants are UTC in `timestamp`
 * columns (Prisma), so a local calendar day is
 *   (column AT TIME ZONE 'UTC' AT TIME ZONE <zone>)::date
 * The zone is bound as a parameter where the fragment is Prisma.sql, and
 * validated before it is ever spliced into raw SQL text.
 */
import { Prisma } from '@prisma/client'

import { DEFAULT_TIMEZONE, isValidTimeZone } from './format'

/** The zone, or Asia/Kolkata when it is not a valid IANA name. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE
}

/** A quoted SQL literal for raw-SQL builders that cannot bind parameters. */
export function timeZoneLiteral(timeZone: string | null | undefined): string {
  // isValidTimeZone allows only [A-Za-z0-9_+-/]: no quote can reach the SQL.
  return `'${safeTimeZone(timeZone)}'`
}

/** The local calendar day of a UTC timestamp expression. */
export function localDateSql(expression: Prisma.Sql, timeZone: string | null | undefined): Prisma.Sql {
  return Prisma.sql`((${expression}) AT TIME ZONE 'UTC' AT TIME ZONE ${safeTimeZone(timeZone)})::date`
}

/** Today's calendar day in the zone. */
export function localTodaySql(timeZone: string | null | undefined): Prisma.Sql {
  return Prisma.sql`(now() AT TIME ZONE ${safeTimeZone(timeZone)})::date`
}

/**
 * `deadlineDayKey` in SQL over a UTC timestamp expression: a value at exactly
 * 00:00 UTC is a date-only deadline (its own date in every zone); anything
 * else is an instant read in the zone.
 */
export function deadlineDaySql(expression: Prisma.Sql, timeZone: string | null | undefined | Prisma.Sql): Prisma.Sql {
  const zone = typeof timeZone === 'object' && timeZone !== null ? timeZone : Prisma.sql`${safeTimeZone(timeZone as string | null | undefined)}`
  return Prisma.sql`(CASE WHEN (${expression})::time = time '00:00' THEN (${expression})::date
    ELSE ((${expression}) AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date END)`
}

/** `deadlineDaySql` for raw-SQL builders: the expression and a validated zone literal. */
export function deadlineDayRaw(expression: string, timeZone: string | null | undefined): string {
  const zone = timeZoneLiteral(timeZone)
  return `(CASE WHEN (${expression})::time = time '00:00' THEN (${expression})::date ELSE ((${expression}) AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date END)`
}
