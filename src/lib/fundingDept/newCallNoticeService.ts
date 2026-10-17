import { createNotifications } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { loadUnitAreaProfile, relevantCallWhereSql } from '@/lib/funding/callUnitRelevance'
import { formatDeadlineDate } from '@/lib/i18n/format'
import { getTenantLocale } from '@/lib/tenant/locale'

import { isMemberAway } from './shared'

/**
 * Tells the officer covering a school that a call landed in their disciplines.
 *
 * Researcher alerts already go out on publish, but they go to researchers. The
 * department officer answerable for chasing that school learned about the call
 * only by opening the queue, which means an unwatched queue is an unworked one.
 *
 * Coverage is per school, so this fans out per school rather than per call:
 * one call relevant to three schools notifies three officers, each about their
 * own school, and each with a link that lands on that school's queue.
 */

export interface NewCallNoticeResult {
  fundingCallId: string
  schoolsMatched: number
  notified: number
  reroutedForLeave: number
}

/**
 * Who should hear about work landing in this school right now.
 *
 * Identical in intent to `ticklerRecipients` in reminderService: while the
 * covering officer is away, their deputy hears instead, and if there is no
 * deputy the officer still hears — an unread notice beats a dropped one.
 */
async function recipientsForSchool(
  tenantId: string,
  orgUnitId: string,
  member: { user_id: string; away_from: Date | null; away_until: Date | null }
): Promise<{ userIds: string[]; rerouted: boolean }> {
  if (!isMemberAway(member)) {
    return { userIds: [member.user_id], rerouted: false }
  }

  const deputy = await prisma.fundingDeptSchoolAssignment.findFirst({
    where: {
      tenant_id: tenantId,
      org_unit_id: orgUnitId,
      is_deputy: true,
      member: { is_active: true },
    },
    select: { member: { select: { user_id: true } } },
  })

  const deputyUserId = deputy?.member?.user_id
  if (!deputyUserId || deputyUserId === member.user_id) {
    return { userIds: [member.user_id], rerouted: false }
  }
  return { userIds: [deputyUserId], rerouted: true }
}

type CoverageRow = {
  tenant_id: string
  org_unit_id: string
  org_unit: { id: string; name: string; is_active: boolean } | null
  member: { user_id: string; away_from: Date | null; away_until: Date | null }
}

/**
 * The covered schools a call is relevant to (primary coverage, mapped schools
 * only), by the same rule the notice below uses, so a preview of who would be
 * told and the notice itself cannot disagree.
 */
export async function coveredSchoolsForCall(callId: string, tenantIds?: string[]): Promise<CoverageRow[]> {
  // Primary coverage only. A deputy is a standby for absence, not a second
  // person to notify about every publish.
  const coverage = await prisma.fundingDeptSchoolAssignment.findMany({
    where: { is_deputy: false, member: { is_active: true }, ...(tenantIds ? { tenant_id: { in: tenantIds } } : {}) },
    select: {
      tenant_id: true,
      org_unit_id: true,
      org_unit: { select: { id: true, name: true, is_active: true } },
      member: { select: { user_id: true, away_from: true, away_until: true } },
    },
  })
  const relevant: CoverageRow[] = []
  for (const row of coverage) {
    if (!row.org_unit?.is_active) continue
    const profile = await loadUnitAreaProfile(row.tenant_id, [row.org_unit_id])
    // An unmapped school matches everything, which would make this notice a
    // firehose rather than a signal. Silence until the school is mapped is the
    // right trade: the call is still in their queue either way.
    if (profile.isUnmapped) continue
    const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT fc.id FROM funding_calls fc
       WHERE fc.id = ${callId}
         AND ${relevantCallWhereSql(profile, 'fc', { includeUnclassified: false })}
    `)
    if (matches.length > 0) relevant.push(row)
  }
  return relevant
}

export async function notifyCoveringOfficers(
  fundingCallId: string
): Promise<NewCallNoticeResult> {
  const result: NewCallNoticeResult = {
    fundingCallId,
    schoolsMatched: 0,
    notified: 0,
    reroutedForLeave: 0,
  }

  const call = await prisma.fundingCall.findUnique({
    where: { id: fundingCallId },
    select: {
      id: true,
      title: true,
      scheme_title: true,
      agency_name: true,
      agencyName: true,
      close_date: true,
      deadlineAt: true,
      notification_policy: true,
      visibility: true,
    },
  })
  if (!call) return result
  // Bulk-imported catalogue calls never notify officers (and are not
  // funding-department calls at all until a curator promotes one).
  if (call.notification_policy === 'SUPPRESSED' || call.visibility === 'GLOBAL_CATALOG') return result

  const title = call.scheme_title || call.title || 'A new funding call'
  const agency = call.agency_name || call.agencyName
  const closesAt = call.close_date || call.deadlineAt

  for (const row of await coveredSchoolsForCall(call.id)) {
    if (!row.org_unit) continue
    result.schoolsMatched += 1

    const { userIds, rerouted } = await recipientsForSchool(
      row.tenant_id,
      row.org_unit_id,
      row.member
    )
    if (rerouted) result.reroutedForLeave += 1

    // The deadline in the tenant's zone and date style; a date-only deadline keeps its date.
    const tenantLocale = await getTenantLocale(row.tenant_id)
    const closes = formatDeadlineDate(closesAt, { timeZone: tenantLocale.timezone, locale: tenantLocale.locale })
    const bodyParts = [
      agency ? `From ${agency}.` : null,
      closes ? `Closes ${closes}.` : null,
      `Matches ${row.org_unit.name}.`,
    ].filter(Boolean)

    result.notified += await createNotifications({
      tenantId: row.tenant_id,
      userIds,
      title: `New call for ${row.org_unit.name}: ${title}`,
      body: bodyParts.join(' '),
      category: 'FUNDING_MATCH',
      linkUrl: `/funding-dept/calls/${call.id}?school=${row.org_unit_id}`,
    })
  }

  return result
}

/**
 * Fire-and-forget wrapper for the publish path, matching
 * `dispatchFundingAlertsQuietly`: a notification failure must never fail or
 * delay a publish.
 */
export function notifyCoveringOfficersQuietly(fundingCallId: string): void {
  void notifyCoveringOfficers(fundingCallId).catch((error) => {
    console.warn(
      `[DEPT-NOTICE] Could not notify covering officers for call ${fundingCallId}:`,
      error instanceof Error ? error.message : String(error)
    )
  })
}
