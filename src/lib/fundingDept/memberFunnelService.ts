import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import type { CallRelevance, RelevanceTier } from '@/lib/funding/callUnitRelevance'

import { getSchoolCallLedger, type ActivityWindow, type LedgerAllocation } from './accountabilityService'
import { textArray } from './callSql'
import { listMembers } from './membershipService'
import { getSchoolFunnel } from './schoolFunnelService'
import { serializeMember } from './shared'

export type AllocationWorkState = 'PENDING' | 'SUBMITTED' | 'CLOSED_WITHOUT_SUBMISSION'
export type AllocationDetailedStage =
  | 'AWAITING_FACULTY_RESPONSE'
  | 'ACCEPTED_IN_HAND'
  | 'PROPOSAL_DRAFTING'
  | 'INTERNAL_REVIEW'
  | 'CLEARED_AND_READY'
  | 'OVERDUE'
  | 'SUBMITTED'
  | 'UNDER_AGENCY_REVIEW'
  | 'REVISION_REQUESTED'
  | 'SANCTIONED'
  | 'REJECTED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'LAPSED_NOT_APPLIED'

export interface DsrAllocationDetail {
  id: string
  faculty: { id: string; name: string | null; email: string | null }
  allocatedBy: { id: string; name: string | null } | null
  allocatedAt: Date
  followUp: { followedUp: boolean; contactEvents: number; lastAt: Date | null; lastKind: string | null; performedBy: { id: string; name: string | null } | null }
  detailedStage: AllocationDetailedStage
  workState: AllocationWorkState
  deadline: Date | null
  submittedAt: Date | null
  submission: {
    reference: string | null
    url: string | null
    notes: string | null
    evidenceStatus: string
    recordedBy: { id: string; name: string | null } | null
  }
  proposal: { id: string; status: string; versionNo: number } | null
  exceptions: Array<'OVERDUE' | 'NO_FOLLOW_UP' | 'MISSING_SUBMISSION_PROOF'>
}

export interface DsrCallFunnelRow {
  id: string
  title: string | null
  agency: string | null
  deadline: Date | null
  publishedAt: Date | null
  relevance: CallRelevance & { provenance: 'saved' | 'inferred' | 'rule' | 'manual' }
  matchedFaculty: number
  shortlistedOrApproached: number
  allocated: number
  pending: number
  submitted: number
  declined: number
  lapsed: number
  overdue: number
  needsAttention: number
  lastActionAt: Date | null
  responsibleOfficer: string | null
  nobodyAllocatedWarning: boolean
  childCount: number
  allocations: DsrAllocationDetail[]
}

export interface DsrSchoolFunnelRow {
  id: string
  name: string
  code: string | null
  isUnmapped: boolean
  relevantCalls: number
  facultyMatches: number
  allocated: number
  pending: number
  followedUp: number
  contactEvents: number
  submitted: number
  overdue: number
  needsAttention: number
  childCount: number
  calls: DsrCallFunnelRow[]
}

export interface DsrMemberFunnelRow {
  id: string
  userId: string | null
  name: string
  email: string | null
  unassigned: boolean
  schools: number
  relevantCalls: number
  facultyMatches: number
  allocated: number
  followedUp: number
  contactEvents: number
  submitted: number
  needsAttention: number
  childCount: number
  schoolRows: DsrSchoolFunnelRow[]
}

export interface MemberFunnelFilters {
  memberIds?: string[]
  schoolIds?: string[]
  allSchools?: boolean
  callId?: string | null
  workState?: AllocationWorkState | null
  detailedStage?: AllocationDetailedStage | null
  relevanceQuality?: RelevanceTier | null
  exception?: 'overdue' | 'no-follow-up' | 'missing-submission-proof' | null
}

function inWindow(value: Date | null | undefined, window: ActivityWindow) {
  if (!value) return false
  const time = new Date(value).getTime()
  return time >= window.start.getTime() && time <= window.end.getTime()
}

export function allocationReportingState(allocation: LedgerAllocation): {
  workState: AllocationWorkState
  detailedStage: AllocationDetailedStage
} {
  const proposal = String(allocation.proposal?.status || '').toUpperCase()
  const progress = allocation.progress.code
  const submitted = Boolean(allocation.submittedAt) || ['SUBMITTED', 'UNDER_AGENCY_REVIEW', 'REVISION_REQUESTED', 'SANCTIONED', 'REJECTED'].includes(proposal)

  const workState: AllocationWorkState = submitted
    ? 'SUBMITTED'
    : ['DECLINED', 'CANCELLED', 'LAPSED'].includes(progress)
      ? 'CLOSED_WITHOUT_SUBMISSION'
      : 'PENDING'

  if (proposal === 'SANCTIONED' || progress === 'AWARDED') return { workState, detailedStage: 'SANCTIONED' }
  if (proposal === 'REJECTED' || progress === 'REJECTED') return { workState, detailedStage: 'REJECTED' }
  if (proposal === 'UNDER_AGENCY_REVIEW') return { workState, detailedStage: 'UNDER_AGENCY_REVIEW' }
  if (proposal === 'REVISION_REQUESTED') return { workState, detailedStage: 'REVISION_REQUESTED' }
  if (submitted || progress === 'SUBMITTED') return { workState, detailedStage: 'SUBMITTED' }
  if (proposal === 'CLEARED') return { workState, detailedStage: 'CLEARED_AND_READY' }
  if (proposal === 'IN_REVIEW') return { workState, detailedStage: 'INTERNAL_REVIEW' }
  if (proposal === 'DRAFT' || progress === 'DRAFTING') return { workState, detailedStage: 'PROPOSAL_DRAFTING' }
  if (progress === 'OVERDUE') return { workState, detailedStage: 'OVERDUE' }
  if (progress === 'AWAITING_REPLY') return { workState, detailedStage: 'AWAITING_FACULTY_RESPONSE' }
  if (progress === 'DECLINED') return { workState, detailedStage: 'DECLINED' }
  if (progress === 'CANCELLED') return { workState, detailedStage: 'CANCELLED' }
  if (progress === 'LAPSED') return { workState, detailedStage: 'LAPSED_NOT_APPLIED' }
  return { workState, detailedStage: 'ACCEPTED_IN_HAND' }
}

export function toDsrAllocationDetail(row: LedgerAllocation): DsrAllocationDetail {
  const state = allocationReportingState(row)
  const evidenceStatus = row.submissionEvidenceStatus ||
    ([row.submissionReference, row.submissionUrl, row.submissionNotes].filter(Boolean).length ? 'LEGACY_PROOF' : 'MISSING')
  const exceptions: DsrAllocationDetail['exceptions'] = []
  if (state.detailedStage === 'OVERDUE') exceptions.push('OVERDUE')
  if (state.workState === 'PENDING' && row.externalContactCount === 0) exceptions.push('NO_FOLLOW_UP')
  if (state.workState === 'SUBMITTED' && evidenceStatus === 'MISSING') exceptions.push('MISSING_SUBMISSION_PROOF')
  return {
    id: row.id,
    faculty: row.assignee,
    allocatedBy: row.assignedBy,
    allocatedAt: row.allocatedAt,
    followUp: {
      followedUp: row.externalContactCount > 0,
      contactEvents: row.externalContactCount,
      lastAt: row.lastExternalContactAt,
      lastKind: row.lastExternalContactKind,
      performedBy: row.lastExternalContactBy,
    },
    detailedStage: state.detailedStage,
    workState: state.workState,
    deadline: row.deadlineAt,
    submittedAt: row.submittedAt,
    submission: {
      reference: row.submissionReference,
      url: row.submissionUrl,
      notes: row.submissionNotes,
      evidenceStatus,
      recordedBy: row.submissionRecordedBy,
    },
    proposal: row.proposal,
    exceptions,
  }
}

export function summarizeSchoolRows(schools: DsrSchoolFunnelRow[]) {
  return {
    schools: schools.length,
    relevantCalls: schools.reduce((sum, row) => sum + row.relevantCalls, 0),
    facultyMatches: schools.reduce((sum, row) => sum + row.facultyMatches, 0),
    allocated: schools.reduce((sum, row) => sum + row.allocated, 0),
    followedUp: schools.reduce((sum, row) => sum + row.followedUp, 0),
    contactEvents: schools.reduce((sum, row) => sum + row.contactEvents, 0),
    submitted: schools.reduce((sum, row) => sum + row.submitted, 0),
    needsAttention: schools.reduce((sum, row) => sum + row.needsAttention, 0),
  }
}

export async function getMemberFunnelReport(
  tenantId: string,
  window: ActivityWindow,
  filters: MemberFunnelFilters = {}
) {
  const allMembers = await listMembers(tenantId)
  const serialized = allMembers.map(serializeMember)
  const allowedMembers = filters.memberIds
    ? serialized.filter((member) => filters.memberIds!.includes(member.id))
    : serialized

  const owners = new Map<string, (typeof allowedMembers)[number]>()
  for (const member of allowedMembers) {
    for (const school of member.schools) {
      if (!filters.schoolIds || filters.schoolIds.includes(school.id)) owners.set(school.id, member)
    }
  }

  const allSchoolRows = await getSchoolFunnel(tenantId)
  const includeUnassigned = !filters.memberIds && (filters.allSchools ?? true)
  const unassignedSchools = includeUnassigned
    ? allSchoolRows.filter((school) => !serialized.some((member) => member.schools.some((owned: any) => owned.id === school.schoolId)))
    : []
  const schoolIds = Array.from(new Set([
    ...owners.keys(),
    ...unassignedSchools.map((school) => school.schoolId),
  ])).filter((id) => !filters.schoolIds || filters.schoolIds.includes(id))

  const [ledgers, matches, candidateRows] = await Promise.all([
    Promise.all(schoolIds.map((schoolId) => getSchoolCallLedger(tenantId, schoolId, { window }))),
    schoolIds.length
      ? prisma.$queryRaw<Array<{ school_id: string; funding_call_id: string; count: number; inferred: boolean; first_seen_at: Date }>>(Prisma.sql`
          SELECT school_id, funding_call_id, COUNT(DISTINCT user_id)::int AS count,
                 BOOL_AND(inferred) AS inferred, MIN(first_seen_at) AS first_seen_at
            FROM funding_opportunity_matches
           WHERE tenant_id = ${tenantId} AND school_id = ANY(${textArray(schoolIds)})
           GROUP BY school_id, funding_call_id
        `)
      : Promise.resolve([]),
    schoolIds.length
      ? prisma.$queryRaw<Array<{ school_id: string; funding_call_id: string; count: number }>>(Prisma.sql`
          SELECT root.school_id, cc.funding_call_id, COUNT(DISTINCT cc.user_id)::int AS count
            FROM call_candidates cc
            JOIN researcher_profiles rp ON rp.user_id = cc.user_id
            JOIN LATERAL (
              SELECT unnest(u.path) AS school_id FROM tenant_org_units u WHERE u.id = rp.org_unit_id
            ) root ON root.school_id = ANY(${textArray(schoolIds)})
           WHERE cc.tenant_id = ${tenantId}
             AND cc.status IN ('SHORTLISTED','APPROACHED','ASSIGNED')
           GROUP BY root.school_id, cc.funding_call_id
        `)
      : Promise.resolve([]),
  ])

  const matchMap = new Map(matches.map((row) => [`${row.school_id}:${row.funding_call_id}`, row]))
  const candidateMap = new Map(candidateRows.map((row) => [`${row.school_id}:${row.funding_call_id}`, row.count]))
  const schoolRows: DsrSchoolFunnelRow[] = []

  for (const ledger of ledgers) {
    const calls: DsrCallFunnelRow[] = []
    for (const call of ledger.calls) {
      if (filters.callId && call.callId !== filters.callId) continue
      const match = matchMap.get(`${ledger.school.id}:${call.callId}`)
      const surfacedInWindow = inWindow(match?.first_seen_at, window) ||
        inWindow(call.publishedAt, window) || call.allocations.some((allocation) => inWindow(allocation.allocatedAt, window))
      if (!surfacedInWindow) continue
      if (filters.relevanceQuality && call.relevance.tier !== filters.relevanceQuality) continue

      let allocations = call.allocations.map(toDsrAllocationDetail)
      const hadAllocationsBeforeFilters = allocations.length > 0
      if (filters.workState) allocations = allocations.filter((row) => row.workState === filters.workState)
      if (filters.detailedStage) allocations = allocations.filter((row) => row.detailedStage === filters.detailedStage)
      if (filters.exception) {
        const key = filters.exception === 'overdue' ? 'OVERDUE' : filters.exception === 'no-follow-up' ? 'NO_FOLLOW_UP' : 'MISSING_SUBMISSION_PROOF'
        allocations = allocations.filter((row) => row.exceptions.includes(key))
      }

      const pending = allocations.filter((row) => row.workState === 'PENDING').length
      const submitted = allocations.filter((row) => row.workState === 'SUBMITTED').length
      const declined = allocations.filter((row) => row.detailedStage === 'DECLINED').length
      const lapsed = allocations.filter((row) => row.detailedStage === 'LAPSED_NOT_APPLIED').length
      const overdue = allocations.filter((row) => row.detailedStage === 'OVERDUE').length
      const needsAttention = allocations.filter((row) => row.exceptions.length > 0).length + (hadAllocationsBeforeFilters ? 0 : 1)
      const relevance = call.triageStatus === 'RELEVANT'
        ? { ...call.relevance, provenance: 'manual' as const }
        : match
          ? { ...call.relevance, provenance: match.inferred ? 'inferred' as const : 'saved' as const }
          : { ...call.relevance, provenance: 'rule' as const }
      calls.push({
        id: call.callId,
        title: call.title,
        agency: call.agencyName,
        deadline: call.closesAt,
        publishedAt: call.publishedAt,
        relevance,
        matchedFaculty: match?.count || 0,
        shortlistedOrApproached: candidateMap.get(`${ledger.school.id}:${call.callId}`) || 0,
        allocated: allocations.length,
        pending,
        submitted,
        declined,
        lapsed,
        overdue,
        needsAttention,
        lastActionAt: call.lastActionAt,
        responsibleOfficer: owners.get(ledger.school.id)?.name || null,
        nobodyAllocatedWarning: !hadAllocationsBeforeFilters,
        childCount: allocations.length,
        allocations,
      })
    }

    const allocations = calls.flatMap((call) => call.allocations)
    schoolRows.push({
      id: ledger.school.id,
      name: ledger.school.name,
      code: ledger.school.code,
      isUnmapped: ledger.school.isUnmapped,
      relevantCalls: calls.length,
      facultyMatches: calls.reduce((sum, call) => sum + call.matchedFaculty, 0),
      allocated: allocations.length,
      pending: allocations.filter((row) => row.workState === 'PENDING').length,
      followedUp: allocations.filter((row) => row.followUp.followedUp).length,
      contactEvents: allocations.reduce((sum, row) => sum + row.followUp.contactEvents, 0),
      submitted: allocations.filter((row) => row.workState === 'SUBMITTED').length,
      overdue: allocations.filter((row) => row.detailedStage === 'OVERDUE').length,
      needsAttention: calls.reduce((sum, call) => sum + call.needsAttention, 0),
      childCount: calls.length,
      calls,
    })
  }

  const members: DsrMemberFunnelRow[] = allowedMembers.map((member) => {
    const rows = schoolRows.filter((school) => member.schools.some((owned: any) => owned.id === school.id))
    const totals = summarizeSchoolRows(rows)
    return {
      id: member.id,
      userId: member.userId,
      name: member.name || member.email || 'Unnamed member',
      email: member.email,
      unassigned: false,
      ...totals,
      childCount: rows.length,
      schoolRows: rows,
    }
  })
  if (includeUnassigned && unassignedSchools.length > 0) {
    const rows = schoolRows.filter((school) => unassignedSchools.some((unassigned) => unassigned.schoolId === school.id))
    const totals = summarizeSchoolRows(rows)
    members.push({
      id: 'unassigned', userId: null, name: 'Unassigned DSR ownership', email: null,
      unassigned: true, ...totals, childCount: rows.length, schoolRows: rows,
    })
  }

  const totals = summarizeSchoolRows(members.flatMap((member) => member.schoolRows))
  const allCalls = members.flatMap((member) => member.schoolRows.flatMap((school) => school.calls))
  const relevanceBreakdown = {
    confirmed: allCalls.filter((call) => ['direct', 'broad', 'keyword'].includes(call.relevance.tier)).length,
    unclassified: allCalls.filter((call) => call.relevance.tier === 'unclassified').length,
    unmappedSchoolCalls: members.flatMap((member) => member.schoolRows).filter((school) => school.isUnmapped)
      .reduce((sum, school) => sum + school.relevantCalls, 0),
    inferredMatches: allCalls.filter((call) => call.relevance.provenance === 'inferred')
      .reduce((sum, call) => sum + call.matchedFaculty, 0),
  }
  const activity = schoolIds.length
    ? (await prisma.$queryRaw<Array<{ allocations: number; followed_up_allocations: number; contact_events: number; submissions: number; ad_hoc_submissions: number }>>(Prisma.sql`
        SELECT
          (SELECT COUNT(*)::int FROM call_assignments ca JOIN tenant_org_units u ON u.id = ca.assignee_org_unit_id
            WHERE ca.tenant_id = ${tenantId} AND u.path && ${textArray(schoolIds)} AND ca.created_at BETWEEN ${window.start} AND ${window.end}) AS allocations,
          (SELECT COUNT(DISTINCT f.assignment_id)::int FROM assignment_follow_ups f
            JOIN call_assignments ca ON ca.id = f.assignment_id
            JOIN tenant_org_units u ON u.id = COALESCE(f.org_unit_id, ca.assignee_org_unit_id)
            WHERE f.tenant_id = ${tenantId} AND u.path && ${textArray(schoolIds)} AND f.kind IN ('CALL','EMAIL','MEETING') AND f.happened_at BETWEEN ${window.start} AND ${window.end}) AS followed_up_allocations,
          (SELECT COUNT(*)::int FROM assignment_follow_ups f
            JOIN call_assignments ca ON ca.id = f.assignment_id
            JOIN tenant_org_units u ON u.id = COALESCE(f.org_unit_id, ca.assignee_org_unit_id)
            WHERE f.tenant_id = ${tenantId} AND u.path && ${textArray(schoolIds)} AND f.kind IN ('CALL','EMAIL','MEETING') AND f.happened_at BETWEEN ${window.start} AND ${window.end}) AS contact_events,
          (SELECT COUNT(*)::int FROM call_assignments ca JOIN tenant_org_units u ON u.id = ca.assignee_org_unit_id
            WHERE ca.tenant_id = ${tenantId} AND u.path && ${textArray(schoolIds)} AND ca.submitted_at BETWEEN ${window.start} AND ${window.end}) AS submissions,
          (SELECT COUNT(*)::int FROM grant_proposals gp
            WHERE gp.tenant_id = ${tenantId} AND gp.org_unit_id = ANY(${textArray(schoolIds)}) AND gp.assignment_id IS NULL AND gp.submitted_at BETWEEN ${window.start} AND ${window.end}) AS ad_hoc_submissions
      `))[0]
    : { allocations: 0, followed_up_allocations: 0, contact_events: 0, submissions: 0, ad_hoc_submissions: 0 }

  return {
    window,
    definitions: {
      cohort: 'Opportunities first surfaced during the selected period, followed to their latest outcome as of the report date.',
      followedUp: 'A distinct allocation with at least one external phone call, email or meeting; internal notes are excluded.',
      ownership: 'The current primary school officer owns the portfolio. Deputy actions are shown as performed-by activity only.',
    },
    activity: { ...activity, submissions: activity.submissions + activity.ad_hoc_submissions },
    relevanceBreakdown,
    totals,
    members,
  }
}
