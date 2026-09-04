import { prisma } from '@/lib/prisma'

/**
 * The "period of consideration" — the window a tenant judges faculty activity
 * in when deciding who to hand a call to.
 *
 * Institutions do not agree on what a year is: some count 1 Jan - 31 Dec,
 * others an academic 1 Jul - 30 Jun. Counting workload over a window one side
 * did not choose makes the numbers an argument rather than a fact, so the
 * tenant admin sets the two dates and everything that reports "in this period"
 * reads them from here.
 */
export interface ReportingPeriod {
  start: Date
  end: Date
  label: string
  /** True when the tenant has not set one and this is the calendar-year fallback. */
  isDefault: boolean
}

/** Milliseconds are irrelevant here; a period is whole days in the tenant's terms. */
function startOfDay(value: Date): Date {
  const copy = new Date(value)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function endOfDay(value: Date): Date {
  const copy = new Date(value)
  copy.setHours(23, 59, 59, 999)
  return copy
}

function calendarYear(now: Date): ReportingPeriod {
  const year = now.getFullYear()
  return {
    start: startOfDay(new Date(year, 0, 1)),
    end: endOfDay(new Date(year, 11, 31)),
    label: String(year),
    isDefault: true,
  }
}

/**
 * Roll a closed window forward by whole years until it contains `now`.
 *
 * Without this an academic year entered once in 2026 would still be reporting
 * 2026-27 in 2028, and every count on the dossier would quietly be wrong. A
 * window that has not opened yet is left alone — a tenant setting next year's
 * period deliberately means to see next year's.
 */
export function resolvePeriod(
  start: Date,
  end: Date,
  label: string | null,
  now: Date = new Date()
): ReportingPeriod {
  let from = startOfDay(start)
  let to = endOfDay(end)

  if (to < from) {
    // Nonsense stored (or a legacy row); treat it as a single day rather than
    // silently matching nothing.
    to = endOfDay(from)
  }

  let guard = 0
  while (to < now && guard < 50) {
    from = startOfDay(new Date(from.getFullYear() + 1, from.getMonth(), from.getDate()))
    to = endOfDay(new Date(to.getFullYear() + 1, to.getMonth(), to.getDate()))
    guard += 1
  }

  const sameYear = from.getFullYear() === to.getFullYear()
  return {
    start: from,
    end: to,
    label:
      label?.trim() ||
      (sameYear ? String(from.getFullYear()) : `${from.getFullYear()}-${String(to.getFullYear()).slice(-2)}`),
    isDefault: false,
  }
}

/** The tenant's configured window, or the current calendar year if unset. */
export async function getReportingPeriod(
  tenantId: string,
  now: Date = new Date()
): Promise<ReportingPeriod> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      reporting_period_start: true,
      reporting_period_end: true,
      reporting_period_label: true,
    },
  })

  if (!tenant?.reporting_period_start || !tenant?.reporting_period_end) {
    return calendarYear(now)
  }

  return resolvePeriod(
    tenant.reporting_period_start,
    tenant.reporting_period_end,
    tenant.reporting_period_label,
    now
  )
}
