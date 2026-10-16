import { describe, expect, it } from 'vitest'

import { allocationCallClosed } from '@/lib/assignments/manualAllocation'
import { deadlineDayKey, fromZonedDateTimeInput, toZonedDateTimeInput } from '@/lib/i18n/format'
import { deadlineAttention } from '@/lib/fundingDept/managementRules'
import { indiaWeekStart } from '@/lib/fundingDept/reportDefinitions'
import { isExpiredInIndia } from '@/lib/fundingDept/responsibility'
import { resolvePeriodInZone } from '@/lib/tenant/reportingPeriod'

const NY = 'America/New_York'
// Intake stores a date-only deadline ("16 October") at 00:00 UTC.
const DATE_ONLY_OCT_16 = '2026-10-16T00:00:00Z'

describe('deadline days for a tenant outside India', () => {
  it('keeps a date-only deadline on its own date, not the day before', () => {
    expect(deadlineDayKey(DATE_ONLY_OCT_16, NY)).toBe('2026-10-16')
    // An instant is read in the zone: 02:00 UTC on the 17th is still the 16th in New York.
    expect(deadlineDayKey('2026-10-17T02:00:00Z', NY)).toBe('2026-10-16')
  })

  it('keeps the deadline open to the end of the tenant’s day', () => {
    // 23:00 on 16 Oct in New York (03:00 UTC on the 17th): still open there…
    expect(isExpiredInIndia(DATE_ONLY_OCT_16, new Date('2026-10-17T03:00:00Z'), NY)).toBe(false)
    // …though India passed midnight hours ago.
    expect(isExpiredInIndia(DATE_ONLY_OCT_16, new Date('2026-10-17T03:00:00Z'))).toBe(true)
    // 01:00 on 17 Oct in New York: closed.
    expect(isExpiredInIndia(DATE_ONLY_OCT_16, new Date('2026-10-17T05:00:00Z'), NY)).toBe(true)
    expect(allocationCallClosed(DATE_ONLY_OCT_16, new Date('2026-10-17T03:00:00Z'), NY)).toBe(false)
  })

  it('counts days to the deadline in the tenant’s calendar', () => {
    expect(deadlineAttention(DATE_ONLY_OCT_16, new Date('2026-10-14T03:00:00Z'), NY).daysToDeadline).toBe(3)
    expect(deadlineAttention(DATE_ONLY_OCT_16, new Date('2026-10-14T03:00:00Z')).daysToDeadline).toBe(2)
  })

  it('starts reporting weeks on the tenant’s Monday', () => {
    // 02:00 UTC Monday 19 Oct is still Sunday 18 Oct in New York.
    expect(indiaWeekStart('2026-10-19T02:00:00Z', NY)).toBe('2026-10-12')
    expect(indiaWeekStart('2026-10-19T02:00:00Z')).toBe('2026-10-19')
  })

  it('reads and writes action due times in the tenant’s zone', () => {
    const due = fromZonedDateTimeInput('2026-10-16T17:00', NY)
    expect(due?.toISOString()).toBe('2026-10-16T21:00:00.000Z')
    expect(toZonedDateTimeInput('2026-10-16T21:00:00.000Z', NY)).toBe('2026-10-16T17:00')
    // India unchanged: the old +05:30 conversion.
    expect(fromZonedDateTimeInput('2026-10-16T17:00')?.toISOString()).toBe('2026-10-16T11:30:00.000Z')
  })

  it('puts a configured reporting period on the tenant’s midnights, across DST', () => {
    const period = resolvePeriodInZone('2026-07-01', '2027-06-30', null, NY, new Date('2026-10-16T12:00:00Z'))
    expect(period.start.toISOString()).toBe('2026-07-01T04:00:00.000Z')
    expect(period.end.toISOString()).toBe('2027-07-01T03:59:59.999Z')
    expect(period.label).toBe('2026-27')
    const calendar = resolvePeriodInZone(null, null, null, NY, new Date('2027-01-01T03:00:00Z'))
    expect(calendar.label).toBe('2026')
  })
})

describe('deadline dates in emails', () => {
  it('shows a date-only deadline as its own date in every zone', async () => {
    const { formatDeadlineDate } = await import('@/lib/i18n/format')
    expect(formatDeadlineDate(DATE_ONLY_OCT_16)).toBe('16 Oct 2026')
    expect(formatDeadlineDate(DATE_ONLY_OCT_16, { timeZone: NY, locale: 'en-US', month: 'long' })).toBe('October 16, 2026')
    // An instant: 02:00 UTC on the 17th is the 16th in New York, the 17th in India.
    expect(formatDeadlineDate('2026-10-17T02:00:00Z', { timeZone: NY })).toBe('16 Oct 2026')
    expect(formatDeadlineDate('2026-10-17T02:00:00Z')).toBe('17 Oct 2026')
    expect(formatDeadlineDate(null)).toBeNull()
  })
})
