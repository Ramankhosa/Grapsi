import { Prisma } from '@/lib/prisma-generated'

/**
 * Time in raw SQL.
 *
 * Prisma stores DateTime as UTC wall-clock time in `timestamp without time
 * zone` columns and fills `@default(now())` itself, in UTC. Raw SQL does not
 * get that for free: `now()` is a timestamptz, and comparing or assigning it to
 * one of those columns converts through the SESSION time zone — on a server set
 * to Asia/Calcutta that shifts every comparison by 5h30m (a task deferred an
 * hour looked runnable at once and was re-claimed in a loop). JS Date
 * parameters are bound as timestamptz too. So every raw-SQL timestamp goes
 * through these two helpers, whatever the server's time zone is.
 */
export const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`

export function utc(date: Date): Prisma.Sql {
  return Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`
}

export function msInterval(ms: number): Prisma.Sql {
  return Prisma.sql`(${Math.round(ms)} * interval '1 millisecond')`
}
