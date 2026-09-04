/**
 * Reads for the report archive.
 *
 * The archive spans two unrelated tables — `reviewer_calls` (AI grant reviewer)
 * and `idea_intelligence_runs` (funding intelligence) — so every query here has
 * to do two things carefully:
 *
 *  1. Tenant scoping. Both tables carry a denormalized `tenantId` that predates
 *     tenanting, so rows written before it exists hold null. Filtering on
 *     `tenantId` alone silently hides a tenant's oldest reports, which on an
 *     oversight surface reads as "this never happened". Every scoped query
 *     therefore also picks up null-tenant rows owned by a member of the tenant.
 *
 *  2. Combined ordering. When both types are listed together the two tables are
 *     over-fetched to the page boundary, merged, sorted and sliced. That is
 *     exact for offset pagination but grows with depth, so the page depth is
 *     capped rather than left unbounded.
 */

import prisma from '@/lib/prisma'
import {
  emptyRunner,
  findUserIdsInOrgUnit,
  findUserIdsMatching,
  loadRunners,
  loadSchools,
  type ReportRunner,
} from '@/lib/reportsArchive/people'

export type ArchiveReportType = 'reviewer' | 'funding_intelligence'

export const ARCHIVE_REPORT_TYPES: ArchiveReportType[] = ['reviewer', 'funding_intelligence']

/** How deep the merged listing may be paged before the merge gets expensive. */
export const MAX_MERGE_OFFSET = 500

export type ArchiveState = 'completed' | 'in_progress' | 'failed'

export interface ArchiveListParams {
  /** null = both types. */
  type: ArchiveReportType | null
  /** null = every tenant (platform viewers only). */
  tenantId: string | null
  userId: string | null
  /** Org unit (school) the runner belongs to, including its subtree. */
  orgUnitId: string | null
  search: string | null
  state: ArchiveState | null
  dateFrom: Date | null
  dateTo: Date | null
  page: number
  limit: number
}

export interface ArchiveItem {
  id: string
  type: ArchiveReportType
  title: string
  subtitle: string | null
  tenantId: string | null
  tenantName: string | null
  /** Who ran the report. Fields are blank when the platform does not know. */
  runBy: ReportRunner
  state: ArchiveState
  /** Raw per-type status, shown as-is so the archive never invents a value. */
  statusLabel: string
  /** Whether a finished report exists to open. */
  hasReport: boolean
  score: number | null
  /** Reviewer only: reviewed sections and total section rows. */
  sectionsReviewed: number | null
  sectionCount: number | null
  createdAt: Date
  updatedAt: Date
}

export interface ArchiveListResult {
  items: ArchiveItem[]
  total: number
  totals: { reviewer: number; fundingIntelligence: number }
  page: number
  limit: number
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Tenant scoping
// ---------------------------------------------------------------------------

/**
 * Owners of null-tenant rows in `table` who belong to `tenantId`.
 *
 * Resolved from the (small) set of users that actually own untenanted rows
 * rather than from the tenant's whole roster, which on a university tenant is
 * thousands of ids in an IN clause.
 */
async function legacyOwnerIds(
  table: 'reviewerCall' | 'ideaIntelligenceRun',
  tenantId: string
): Promise<string[]> {
  const owners =
    table === 'reviewerCall'
      ? await prisma.reviewerCall.findMany({
          where: { tenantId: null },
          select: { user_id: true },
          distinct: ['user_id'],
        })
      : await prisma.ideaIntelligenceRun.findMany({
          where: { tenantId: null },
          select: { userId: true },
          distinct: ['userId'],
        })

  const ownerIds = (owners as any[]).map((row) => row.user_id ?? row.userId).filter(Boolean)
  if (ownerIds.length === 0) return []

  const members = await prisma.user.findMany({
    where: { id: { in: ownerIds }, tenantId },
    select: { id: true },
  })
  return members.map((member) => member.id)
}

async function reviewerTenantWhere(tenantId: string | null): Promise<Record<string, unknown>> {
  if (!tenantId) return {}
  const ownerIds = await legacyOwnerIds('reviewerCall', tenantId)
  return {
    OR: [
      { tenantId },
      ...(ownerIds.length ? [{ tenantId: null, user_id: { in: ownerIds } }] : []),
    ],
  }
}

async function runTenantWhere(tenantId: string | null): Promise<Record<string, unknown>> {
  if (!tenantId) return {}
  const ownerIds = await legacyOwnerIds('ideaIntelligenceRun', tenantId)
  return {
    OR: [
      { tenantId },
      ...(ownerIds.length ? [{ tenantId: null, userId: { in: ownerIds } }] : []),
    ],
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function dateWhere(field: string, from: Date | null, to: Date | null) {
  if (!from && !to) return {}
  return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
}

/**
 * A reviewer call is "completed" once a panel report exists — the section
 * statuses alone say nothing about whether there is a report to read.
 */
function reviewerStateWhere(state: ArchiveState | null) {
  if (state === 'completed') return { NOT: { overall_review_json: { equals: null } } }
  if (state === 'in_progress') return { overall_review_json: { equals: null } }
  // The reviewer has no failed terminal state, so nothing can match.
  if (state === 'failed') return { id: '__no_such_call__' }
  return {}
}

function runStateWhere(state: ArchiveState | null) {
  if (state === 'completed') return { status: 'COMPLETED' }
  if (state === 'failed') return { status: 'FAILED' }
  if (state === 'in_progress') return { status: { notIn: ['COMPLETED', 'FAILED'] } }
  return {}
}

/**
 * Free-text search.
 *
 * `matchedUserIds` carries the people whose name, email, employee id or school
 * matched — resolved separately because idea-intelligence runs have no user
 * relation to search through, and because "find everything Dr Kaur ran" is the
 * question this archive exists to answer.
 */
function reviewerSearchWhere(search: string | null, matchedUserIds: string[]) {
  if (!search) return {}
  const contains = { contains: search, mode: 'insensitive' as const }
  return {
    OR: [
      { project_title: contains },
      { agency_name: contains },
      ...(matchedUserIds.length ? [{ user_id: { in: matchedUserIds } }] : []),
    ],
  }
}

function runSearchWhere(search: string | null, matchedUserIds: string[]) {
  if (!search) return {}
  const contains = { contains: search, mode: 'insensitive' as const }
  return {
    OR: [
      { title: contains },
      { ideaText: contains },
      ...(matchedUserIds.length ? [{ userId: { in: matchedUserIds } }] : []),
    ],
  }
}

interface ResolvedPeopleFilters {
  /** Users the school filter admits; null when no school filter is set. */
  orgUnitUserIds: string[] | null
  /** Users matching the free-text search; empty when there is no search. */
  matchedUserIds: string[]
}

/**
 * Resolve the person-shaped filters to user ids once, so both report queries
 * apply exactly the same set.
 */
async function resolvePeopleFilters(params: ArchiveListParams): Promise<ResolvedPeopleFilters> {
  const [orgUnitUserIds, matchedUserIds] = await Promise.all([
    params.orgUnitId ? findUserIdsInOrgUnit(params.orgUnitId) : Promise.resolve(null),
    params.search ? findUserIdsMatching(params.search, params.tenantId) : Promise.resolve([]),
  ])
  return { orgUnitUserIds, matchedUserIds }
}

/**
 * The user constraint from the explicit user picker and the school filter
 * combined. A school with no members yields `[]`, which must match nothing —
 * not "no filter" — or the archive would answer a narrow question with
 * everything.
 */
function userScopeWhere(field: 'user_id' | 'userId', params: ArchiveListParams, people: ResolvedPeopleFilters) {
  if (params.userId) {
    if (people.orgUnitUserIds && !people.orgUnitUserIds.includes(params.userId)) {
      return { [field]: { in: [] as string[] } }
    }
    return { [field]: params.userId }
  }
  if (people.orgUnitUserIds) return { [field]: { in: people.orgUnitUserIds } }
  return {}
}

async function buildReviewerWhere(params: ArchiveListParams, people: ResolvedPeopleFilters) {
  return {
    ...(await reviewerTenantWhere(params.tenantId)),
    ...userScopeWhere('user_id', params, people),
    ...dateWhere('created_at', params.dateFrom, params.dateTo),
    ...reviewerStateWhere(params.state),
    ...reviewerSearchWhere(params.search, people.matchedUserIds),
  }
}

async function buildRunWhere(params: ArchiveListParams, people: ResolvedPeopleFilters) {
  return {
    ...(await runTenantWhere(params.tenantId)),
    ...userScopeWhere('userId', params, people),
    ...dateWhere('createdAt', params.dateFrom, params.dateTo),
    ...runStateWhere(params.state),
    ...runSearchWhere(params.search, people.matchedUserIds),
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function mapReviewerRow(row: any, runners: Map<string, ReportRunner>): ArchiveItem {
  const overall = (row.overall_review_json || null) as Record<string, any> | null
  const hasReport = Boolean(overall && Object.keys(overall).length > 0)
  const sections = row.reviewer_sections || []
  const reviewed = sections.filter((section: any) => section.status === 'reviewed').length

  return {
    id: row.id,
    type: 'reviewer',
    title: row.project_title || 'Untitled proposal',
    subtitle: row.agency_name || null,
    tenantId: row.tenantId ?? row.user?.tenantId ?? null,
    tenantName: row.user?.tenant?.name ?? null,
    runBy: runners.get(row.user_id) ?? emptyRunner(row.user_id),
    state: hasReport ? 'completed' : 'in_progress',
    statusLabel: row.final_review_status || row.review_status || 'parsed',
    hasReport,
    score: hasReport ? numeric(overall?.overall_score) : null,
    sectionsReviewed: reviewed,
    sectionCount: sections.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRunRow(
  row: any,
  tenantNames: Map<string, string>,
  runners: Map<string, ReportRunner>
): ArchiveItem {
  const runner = runners.get(row.userId) ?? emptyRunner(row.userId)
  const tenantId = row.tenantId ?? runner.tenantId ?? null
  const scores = (row.scoresJson || null) as Record<string, any> | null
  const report = (row.reportJson || null) as Record<string, any> | null

  return {
    id: row.id,
    type: 'funding_intelligence',
    title: row.title || 'Untitled idea analysis',
    subtitle: typeof report?.headline === 'string' ? report.headline : null,
    tenantId,
    tenantName: tenantId ? tenantNames.get(tenantId) ?? null : null,
    runBy: runner,
    state:
      row.status === 'COMPLETED' ? 'completed' : row.status === 'FAILED' ? 'failed' : 'in_progress',
    statusLabel: row.status,
    hasReport: Boolean(report && Object.keys(report).length > 0),
    score: numeric(scores?.whitespaceScore ?? scores?.overallScore ?? null),
    sectionsReviewed: null,
    sectionCount: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const REVIEWER_SELECT = {
  id: true,
  tenantId: true,
  user_id: true,
  project_title: true,
  agency_name: true,
  review_status: true,
  final_review_status: true,
  overall_review_json: true,
  created_at: true,
  updated_at: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      tenantId: true,
      tenant: { select: { id: true, name: true } },
    },
  },
  reviewer_sections: { select: { id: true, status: true } },
} as const

const RUN_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  title: true,
  status: true,
  scoresJson: true,
  reportJson: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Tenant names for idea-intelligence rows, which carry no tenant relation. */
async function tenantNamesFor(rows: any[], runners: Map<string, ReportRunner>): Promise<Map<string, string>> {
  const tenantIds = Array.from(
    new Set(
      rows
        .map((row) => row.tenantId ?? runners.get(row.userId)?.tenantId ?? null)
        .filter((value): value is string => Boolean(value))
    )
  )
  if (tenantIds.length === 0) return new Map()
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true },
  })
  return new Map(tenants.map((tenant) => [tenant.id, tenant.name]))
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listArchiveReports(params: ArchiveListParams): Promise<ArchiveListResult> {
  const limit = Math.min(100, Math.max(1, params.limit))
  const page = Math.max(1, params.page)
  const skip = (page - 1) * limit

  const people = await resolvePeopleFilters(params)
  const [reviewerWhere, runWhere] = await Promise.all([
    buildReviewerWhere(params, people),
    buildRunWhere(params, people),
  ])

  const wantsReviewer = params.type === null || params.type === 'reviewer'
  const wantsRuns = params.type === null || params.type === 'funding_intelligence'

  const [reviewerTotal, runTotal] = await Promise.all([
    wantsReviewer ? prisma.reviewerCall.count({ where: reviewerWhere as any }) : Promise.resolve(0),
    wantsRuns ? prisma.ideaIntelligenceRun.count({ where: runWhere as any }) : Promise.resolve(0),
  ])

  // Single-type listings paginate natively; the merged listing over-fetches to
  // the page boundary and is capped so a deep page cannot fan out unbounded.
  const merged = wantsReviewer && wantsRuns
  const truncated = merged && skip + limit > MAX_MERGE_OFFSET
  const fetchTake = merged ? Math.min(skip + limit, MAX_MERGE_OFFSET) : limit
  const fetchSkip = merged ? 0 : skip

  const [reviewerRows, runRows] = await Promise.all([
    wantsReviewer
      ? prisma.reviewerCall.findMany({
          where: reviewerWhere as any,
          select: REVIEWER_SELECT,
          orderBy: { created_at: 'desc' },
          take: fetchTake,
          skip: fetchSkip,
        })
      : Promise.resolve([] as any[]),
    wantsRuns
      ? prisma.ideaIntelligenceRun.findMany({
          where: runWhere as any,
          select: RUN_SELECT,
          orderBy: { createdAt: 'desc' },
          take: fetchTake,
          skip: fetchSkip,
        })
      : Promise.resolve([] as any[]),
  ])

  // One runner lookup for both tables: the same person shows up in each.
  const runners = await loadRunners([
    ...(reviewerRows as any[]).map((row) => row.user_id),
    ...(runRows as any[]).map((row) => row.userId),
  ])
  const tenantNames = await tenantNamesFor(runRows as any[], runners)

  const items = [
    ...(reviewerRows as any[]).map((row) => mapReviewerRow(row, runners)),
    ...(runRows as any[]).map((row) => mapRunRow(row, tenantNames, runners)),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return {
    items: merged ? items.slice(skip, skip + limit) : items,
    total: reviewerTotal + runTotal,
    totals: { reviewer: reviewerTotal, fundingIntelligence: runTotal },
    page,
    limit,
    truncated,
  }
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

export interface ArchiveFacets {
  tenants: Array<{ id: string; name: string }>
  /** The people who have actually run a report, with their org placement. */
  users: ReportRunner[]
  /**
   * Schools available to filter by. Empty for a platform viewer who has not
   * picked a tenant — schools are a tenant's own vocabulary, and one flat list
   * across every customer would be meaningless.
   */
  schools: Array<{ id: string; name: string }>
}

/**
 * Filter options. Users are drawn from the people who actually own a report so
 * the picker is not a full roster of accounts that have never run one.
 */
export async function loadArchiveFacets(tenantId: string | null): Promise<ArchiveFacets> {
  const [reviewerWhere, runWhere] = await Promise.all([
    reviewerTenantWhere(tenantId),
    runTenantWhere(tenantId),
  ])

  const [reviewerOwners, runOwners, tenants, schools] = await Promise.all([
    prisma.reviewerCall.findMany({
      where: reviewerWhere as any,
      select: { user_id: true },
      distinct: ['user_id'],
    }),
    prisma.ideaIntelligenceRun.findMany({
      where: runWhere as any,
      select: { userId: true },
      distinct: ['userId'],
    }),
    tenantId
      ? prisma.tenant.findMany({ where: { id: tenantId }, select: { id: true, name: true } })
      : prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    loadSchools(tenantId),
  ])

  const ownerIds = Array.from(
    new Set(
      [
        ...(reviewerOwners as any[]).map((row) => row.user_id),
        ...(runOwners as any[]).map((row) => row.userId),
      ].filter(Boolean)
    )
  )

  const runners = await loadRunners(ownerIds)
  const users = Array.from(runners.values()).sort((a, b) =>
    (a.name || a.email || '').localeCompare(b.name || b.email || '')
  )

  return { tenants, users, schools }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * A reviewer call with everything the read-only report view renders.
 * Returns null when the call does not exist; the caller checks scope.
 */
export async function loadReviewerReport(callId: string) {
  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      tenantId: true,
      user_id: true,
      projectId: true,
      project_title: true,
      agency_name: true,
      review_status: true,
      final_review_status: true,
      parsed_json: true,
      overall_review_json: true,
      LLM_model_used: true,
      created_at: true,
      updated_at: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          tenantId: true,
          tenant: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!call) return null

  const sections = await prisma.reviewerSection.findMany({
    where: { call_id: callId },
    select: {
      id: true,
      section_title: true,
      user_input: true,
      ai_review_json: true,
      status: true,
      version: true,
      is_revision: true,
      mappingJson: true,
      last_reviewed_at: true,
    },
    orderBy: [{ section_title: 'asc' }, { version: 'asc' }],
  })

  return { call, sections, tenantId: call.tenantId ?? call.user?.tenantId ?? null }
}

/** A funding-intelligence run with the stored report payloads. */
export async function loadFundingIntelligenceReport(runId: string) {
  const run = await prisma.ideaIntelligenceRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      sessionId: true,
      title: true,
      ideaText: true,
      status: true,
      currentStage: true,
      structuredIdeaJson: true,
      retrievalResultsJson: true,
      analysisJson: true,
      scoresJson: true,
      reportJson: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!run) return null

  const owner = await prisma.user.findUnique({
    where: { id: run.userId },
    select: {
      id: true,
      name: true,
      email: true,
      tenantId: true,
      tenant: { select: { id: true, name: true } },
    },
  })

  return { run, owner, tenantId: run.tenantId ?? owner?.tenantId ?? null }
}
