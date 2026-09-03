import { Prisma } from '@prisma/client';

import prisma from '../prisma';
import { loadUnitAreaProfile, relevantCallWhereSql } from '../funding/callUnitRelevance';

/**
 * Tenant grant-portfolio analytics.
 *
 * Every panel, report and CSV export derives its buckets from the SQL fragments
 * defined here, so the dashboard headline can never disagree with the report
 * beneath it.
 *
 *   Active    — still open and the internal deadline has not passed.
 *   Submitted — the assignee recorded submission info (status COMPLETED).
 *   Missed    — still open but the internal deadline has passed.
 *
 * Cancelled and declined assignments are deliberately excluded from all three
 * buckets and reported in their own columns. A decline is an answer, not a
 * failure to answer: counting it as missed would blame the department for work
 * the faculty member explicitly turned down, and would hide the real signal —
 * that this call still needs somebody.
 *
 * A fourth, org-level metric — funding calls that expired with nobody assigned
 * — is tracked in `getUnassignedExpiredCalls`, because "we missed it entirely"
 * is a different failure from "someone was on it and did not submit".
 */

export type DashboardGroupBy =
  | 'agency'
  | 'call'
  | 'school'
  | 'department'
  | 'orgUnit'
  | 'faculty'
  | 'assigner'
  | 'assignerUnit'
  | 'year'
  | 'month';

export const DASHBOARD_GROUP_BY: DashboardGroupBy[] = [
  'agency',
  'call',
  'school',
  'department',
  'orgUnit',
  'faculty',
  'assigner',
  'assignerUnit',
  'year',
  'month',
];

export interface DashboardFilters {
  tenantId: string;
  /**
   * SERVER-DERIVED reach of the caller. null/undefined means tenant-wide.
   * Never taken from client input — that is what `orgUnitIds` is for.
   */
  scopeUnitIds?: string[] | null;
  /** Org-unit ids the user chose to filter by, already clamped to their scope. */
  orgUnitIds?: string[];
  /** Filters on the assignment's creation date. */
  dateFrom?: Date | null;
  dateTo?: Date | null;
  agency?: string | null;
  /**
   * Restrict to work delegated by these users. Powers the department's
   * per-member views ("what am I chasing", "what is each of my team chasing").
   */
  assignedByUserIds?: string[];
}

/** Open = the work is still live (not completed, cancelled or declined). */
const OPEN_STATUSES = Prisma.sql`ca.status IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS')`;

const IS_ACTIVE = Prisma.sql`(${OPEN_STATUSES} AND (ca.deadline_at IS NULL OR ca.deadline_at >= CURRENT_DATE))`;
const IS_SUBMITTED = Prisma.sql`ca.status = 'COMPLETED'`;
const IS_MISSED = Prisma.sql`(${OPEN_STATUSES} AND ca.deadline_at IS NOT NULL AND ca.deadline_at < CURRENT_DATE)`;

function combine(conditions: Prisma.Sql[]) {
  return conditions.reduce(
    (combined, condition, index) =>
      index === 0 ? condition : Prisma.sql`${combined} AND ${condition}`,
    Prisma.sql`TRUE`
  );
}

/**
 * Shared WHERE for every assignment query. Tenant scope is applied here and is
 * never taken from client input.
 */
function assignmentWhere(filters: DashboardFilters) {
  const conditions: Prisma.Sql[] = [Prisma.sql`ca.tenant_id = ${filters.tenantId}`];

  // Server-side reach first, so a hand-crafted orgUnitIds query string can only
  // ever narrow what the caller already had access to, never widen it.
  const scopeUnitIds = filters.scopeUnitIds;
  if (scopeUnitIds) {
    conditions.push(
      scopeUnitIds.length === 0
        ? Prisma.sql`FALSE`
        : // Assignments predating the snapshot columns fall back to the
          // assignee's current placement so old rows do not vanish from a
          // head's dashboard.
          Prisma.sql`COALESCE(ca.assignee_org_unit_id, rp.org_unit_id) = ANY(ARRAY[${Prisma.join(
            scopeUnitIds.map((id) => Prisma.sql`${id}`)
          )}]::text[])`
    );
  }

  const orgUnitIds = (filters.orgUnitIds || []).filter(Boolean);
  if (orgUnitIds.length > 0) {
    conditions.push(
      Prisma.sql`COALESCE(ca.assignee_org_unit_id, rp.org_unit_id) = ANY(ARRAY[${Prisma.join(
        orgUnitIds.map((id) => Prisma.sql`${id}`)
      )}]::text[])`
    );
  }
  const assignedByUserIds = (filters.assignedByUserIds || []).filter(Boolean);
  if (assignedByUserIds.length > 0) {
    conditions.push(
      Prisma.sql`ca.assigned_by_user_id = ANY(ARRAY[${Prisma.join(
        assignedByUserIds.map((id) => Prisma.sql`${id}`)
      )}]::text[])`
    );
  }
  if (filters.dateFrom) {
    conditions.push(Prisma.sql`ca.created_at >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(Prisma.sql`ca.created_at <= ${filters.dateTo}`);
  }
  if (filters.agency) {
    conditions.push(
      Prisma.sql`COALESCE(fc.agency_name, fc."agencyName", '') ILIKE ${`%${filters.agency}%`}`
    );
  }

  return combine(conditions);
}

/**
 * Assignments joined to their call and the assignee's profile. LEFT JOIN on the
 * profile so an assignee without a researcher profile still appears (they would
 * otherwise silently vanish from the totals).
 */
function assignmentFrom() {
  return Prisma.sql`
    FROM call_assignments ca
    JOIN funding_calls fc ON fc.id = ca.funding_call_id
    LEFT JOIN users u ON u.id = ca.assignee_user_id
    LEFT JOIN researcher_profiles rp ON rp.user_id = ca.assignee_user_id
    LEFT JOIN users bu ON bu.id = ca.assigned_by_user_id
    LEFT JOIN tenant_org_units aou ON aou.id = ca.assignee_org_unit_id
    LEFT JOIN tenant_org_units bou ON bou.id = ca.assigner_org_unit_id
  `;
}

const BUCKET_COLUMNS = Prisma.sql`
  COUNT(*) FILTER (WHERE ${IS_ACTIVE})::int    AS "active",
  COUNT(*) FILTER (WHERE ${IS_SUBMITTED})::int AS "submitted",
  COUNT(*) FILTER (WHERE ${IS_MISSED})::int    AS "missed",
  COUNT(*) FILTER (WHERE ca.status = 'CANCELLED')::int      AS "cancelled",
  COUNT(*) FILTER (WHERE ca.status = 'DECLINED')::int       AS "declined",
  COUNT(*) FILTER (WHERE ca.outcome = 'AWARDED')::int       AS "awarded",
  COUNT(*) FILTER (WHERE ca.outcome = 'REJECTED')::int      AS "rejected",
  COUNT(*)::int                                             AS "total",
  COALESCE(SUM(ca.award_amount) FILTER (WHERE ca.outcome = 'AWARDED'), 0)::float AS "awardedAmount"
`;

export interface DashboardSummary {
  active: number;
  submitted: number;
  missed: number;
  cancelled: number;
  declined: number;
  awarded: number;
  rejected: number;
  total: number;
  awardedAmount: number;
  unassignedExpiredCalls: number;
  /** Awarded / (awarded + rejected), as a percentage. Null when nothing decided. */
  successRate: number | null;
}

export async function getSummary(filters: DashboardFilters): Promise<DashboardSummary> {
  const [row] = await prisma.$queryRaw<
    Array<Omit<DashboardSummary, 'unassignedExpiredCalls' | 'successRate'>>
  >(Prisma.sql`
    SELECT ${BUCKET_COLUMNS}
    ${assignmentFrom()}
    WHERE ${assignmentWhere(filters)}
  `);

  // Org-level metric by definition ("nobody in the organization took this"),
  // so it is suppressed for a scoped head rather than reported as if it were
  // their branch's number.
  const unassignedExpiredCalls = filters.scopeUnitIds
    ? 0
    : await countUnassignedExpiredCalls(filters.tenantId);
  const decided = (row?.awarded || 0) + (row?.rejected || 0);

  return {
    active: row?.active || 0,
    submitted: row?.submitted || 0,
    missed: row?.missed || 0,
    cancelled: row?.cancelled || 0,
    declined: row?.declined || 0,
    awarded: row?.awarded || 0,
    rejected: row?.rejected || 0,
    total: row?.total || 0,
    awardedAmount: row?.awardedAmount || 0,
    unassignedExpiredCalls,
    successRate: decided > 0 ? Math.round(((row.awarded || 0) / decided) * 1000) / 10 : null,
  };
}

export interface AllocationRow {
  school: string | null;
  department: string | null;
  facultyUserId: string | null;
  facultyName: string | null;
  active: number;
  submitted: number;
  missed: number;
  cancelled: number;
  declined: number;
  awarded: number;
  rejected: number;
  total: number;
  awardedAmount: number;
}

/** Per-faculty allocation; the UI rolls these up into school -> department. */
export async function getAllocation(filters: DashboardFilters): Promise<AllocationRow[]> {
  return prisma.$queryRaw<AllocationRow[]>(Prisma.sql`
    SELECT
      rp.school                                        AS "school",
      rp.department                                    AS "department",
      ca.assignee_user_id                              AS "facultyUserId",
      COALESCE(rp.display_name, u.name, u.email, '—')  AS "facultyName",
      ${BUCKET_COLUMNS}
    ${assignmentFrom()}
    WHERE ${assignmentWhere(filters)}
    GROUP BY rp.school, rp.department, ca.assignee_user_id, COALESCE(rp.display_name, u.name, u.email, '—')
    ORDER BY rp.school NULLS LAST, rp.department NULLS LAST, "facultyName"
  `);
}

export interface AssignmentListRow {
  id: string;
  callTitle: string | null;
  agencyName: string | null;
  facultyName: string | null;
  school: string | null;
  department: string | null;
  deadlineAt: Date | null;
  status: string;
  outcome: string;
}

function listSelect() {
  return Prisma.sql`
    ca.id,
    COALESCE(fc.scheme_title, fc.title)              AS "callTitle",
    COALESCE(fc.agency_name, fc."agencyName")        AS "agencyName",
    COALESCE(rp.display_name, u.name, u.email, '—')  AS "facultyName",
    rp.school,
    rp.department,
    ca.deadline_at                                   AS "deadlineAt",
    ca.status::text                                  AS "status",
    ca.outcome::text                                 AS "outcome"
  `;
}

/** Open assignments whose deadline has already passed. */
export async function getMissedAssignments(filters: DashboardFilters, limit = 50) {
  return prisma.$queryRaw<AssignmentListRow[]>(Prisma.sql`
    SELECT ${listSelect()}
    ${assignmentFrom()}
    WHERE ${assignmentWhere(filters)} AND ${IS_MISSED}
    ORDER BY ca.deadline_at ASC
    LIMIT ${limit}
  `);
}

/** Active assignments with a deadline inside the next `days` days. */
export async function getUpcomingDeadlines(filters: DashboardFilters, days = 30, limit = 50) {
  return prisma.$queryRaw<AssignmentListRow[]>(Prisma.sql`
    SELECT ${listSelect()}
    ${assignmentFrom()}
    WHERE ${assignmentWhere(filters)}
      AND ${IS_ACTIVE}
      AND ca.deadline_at IS NOT NULL
      AND ca.deadline_at < CURRENT_DATE + ${`${days} days`}::interval
    ORDER BY ca.deadline_at ASC
    LIMIT ${limit}
  `);
}

/**
 * Tenant-visible funding calls that closed with nobody assigned — opportunities
 * the organization let lapse entirely. Mirrors the visibility rule in
 * `tenantVisibleCallWhere` (own calls + globally published ones).
 */
function unassignedExpiredWhere(tenantId: string) {
  return Prisma.sql`
    (
      (
        fc."tenantId" = ${tenantId}
        AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED')
      )
      OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
    )
    AND COALESCE(fc.close_date, fc."deadlineAt") IS NOT NULL
    AND COALESCE(fc.close_date, fc."deadlineAt") < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM call_assignments x
      WHERE x.funding_call_id = fc.id AND x.tenant_id = ${tenantId}
    )
  `;
}

export async function countUnassignedExpiredCalls(tenantId: string) {
  const [row] = await prisma.$queryRaw<[{ count: number }]>(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM funding_calls fc WHERE ${unassignedExpiredWhere(tenantId)}
  `);
  return row?.count || 0;
}

export async function getUnassignedExpiredCalls(tenantId: string, limit = 50) {
  return prisma.$queryRaw<
    Array<{ id: string; title: string | null; agencyName: string | null; closedAt: Date | null }>
  >(Prisma.sql`
    SELECT
      fc.id,
      COALESCE(fc.scheme_title, fc.title)          AS "title",
      COALESCE(fc.agency_name, fc."agencyName")    AS "agencyName",
      COALESCE(fc.close_date, fc."deadlineAt")     AS "closedAt"
    FROM funding_calls fc
    WHERE ${unassignedExpiredWhere(tenantId)}
    ORDER BY COALESCE(fc.close_date, fc."deadlineAt") DESC
    LIMIT ${limit}
  `);
}

/**
 * Open calls that nobody in the caller's schools has been put on yet, with the
 * closing date approaching.
 *
 * Deliberately different from `getUnassignedExpiredCalls`, which is a
 * tenant-level post-mortem. This one is scoped and forward-looking: it is the
 * list a department member can still do something about, so "assigned" means
 * "assigned to someone in MY schools" — a call taken up in a school I do not
 * cover is not my job and must not disappear from my worklist because of it.
 */
export async function getUnassignedUpcomingCalls(
  tenantId: string,
  options: {
    withinDays?: number;
    scopeUnitIds?: string[] | null;
    limit?: number;
    /**
     * Narrow to calls in these units' disciplines. Without it this list is
     * every open call in the tenant, which is how an officer covering
     * Pharmacy ended up looking at quantum-computing backlog. Units with
     * nothing mapped fall back to the unfiltered list rather than an empty
     * one — see `relevantCallWhereSql`.
     */
    relevanceUnitIds?: string[] | null;
  } = {}
) {
  const { withinDays = 45, scopeUnitIds = null, limit = 25, relevanceUnitIds = null } = options;
  if (scopeUnitIds && scopeUnitIds.length === 0) {
    return [];
  }

  const relevancePredicate =
    relevanceUnitIds && relevanceUnitIds.length > 0
      ? relevantCallWhereSql(await loadUnitAreaProfile(tenantId, relevanceUnitIds), 'fc')
      : Prisma.sql`TRUE`;

  // A cancelled or declined assignment means nobody is on this call: the
  // request was withdrawn or turned down. Both must leave the call visible
  // here, or a decline would quietly remove it from the very list whose job is
  // to say "this still needs somebody".
  const notTakenUp = Prisma.sql`x.status NOT IN ('CANCELLED', 'DECLINED')`;

  const coveredPredicate = scopeUnitIds
    ? Prisma.sql`
        AND NOT EXISTS (
          SELECT 1
            FROM call_assignments x
            LEFT JOIN researcher_profiles xrp ON xrp.user_id = x.assignee_user_id
           WHERE x.funding_call_id = fc.id
             AND x.tenant_id = ${tenantId}
             AND ${notTakenUp}
             AND COALESCE(x.assignee_org_unit_id, xrp.org_unit_id) = ANY(ARRAY[${Prisma.join(
               scopeUnitIds.map((id) => Prisma.sql`${id}`)
             )}]::text[])
        )`
    : Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM call_assignments x
           WHERE x.funding_call_id = fc.id
             AND x.tenant_id = ${tenantId}
             AND ${notTakenUp}
        )`;

  return prisma.$queryRaw<
    Array<{ id: string; title: string | null; agencyName: string | null; closesAt: Date | null }>
  >(Prisma.sql`
    SELECT
      fc.id,
      COALESCE(fc.scheme_title, fc.title)       AS "title",
      COALESCE(fc.agency_name, fc."agencyName") AS "agencyName",
      COALESCE(fc.close_date, fc."deadlineAt")  AS "closesAt"
    FROM funding_calls fc
    WHERE (
        (
          fc."tenantId" = ${tenantId}
          AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED')
        )
        OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
      )
      AND COALESCE(fc.close_date, fc."deadlineAt") IS NOT NULL
      AND COALESCE(fc.close_date, fc."deadlineAt") >= CURRENT_DATE
      AND COALESCE(fc.close_date, fc."deadlineAt") < CURRENT_DATE + ${`${withinDays} days`}::interval
      AND ${relevancePredicate}
      ${coveredPredicate}
    ORDER BY COALESCE(fc.close_date, fc."deadlineAt") ASC
    LIMIT ${limit}
  `);
}

export interface ReportRow {
  label: string;
  active: number;
  submitted: number;
  missed: number;
  cancelled: number;
  declined: number;
  awarded: number;
  rejected: number;
  total: number;
  awardedAmount: number;
}

/** SQL expression producing the grouping label, per groupBy mode. */
function groupExpression(groupBy: DashboardGroupBy): Prisma.Sql {
  switch (groupBy) {
    case 'agency':
      return Prisma.sql`COALESCE(NULLIF(COALESCE(fc.agency_name, fc."agencyName"), ''), 'Unknown agency')`;
    case 'call':
      return Prisma.sql`COALESCE(NULLIF(COALESCE(fc.scheme_title, fc.title), ''), 'Untitled call')`;
    case 'school':
      return Prisma.sql`COALESCE(NULLIF(rp.school, ''), 'Unassigned school')`;
    case 'department':
      return Prisma.sql`COALESCE(NULLIF(rp.department, ''), 'Unassigned department')`;
    // Depth-agnostic: groups by the unit the person actually sits in, whatever
    // level that is, rather than the two fixed school/department slots.
    case 'orgUnit':
      return Prisma.sql`COALESCE(NULLIF(aou.name, ''), NULLIF(rp.department, ''), NULLIF(rp.school, ''), 'Unassigned unit')`;
    case 'faculty':
      return Prisma.sql`COALESCE(rp.display_name, u.name, u.email, 'Unknown')`;
    // Who delegated the work. Uses the users table, not a profile join — the
    // assigner is frequently an admin with no researcher profile at all.
    case 'assigner':
      return Prisma.sql`COALESCE(NULLIF(bu.name, ''), bu.email, 'Unknown')`;
    case 'assignerUnit':
      return Prisma.sql`COALESCE(NULLIF(bou.name, ''), 'Unattributed')`;
    case 'year':
      return Prisma.sql`to_char(ca.created_at, 'YYYY')`;
    case 'month':
      return Prisma.sql`to_char(ca.created_at, 'YYYY-MM')`;
  }
}

export async function getReport(
  filters: DashboardFilters,
  groupBy: DashboardGroupBy
): Promise<ReportRow[]> {
  const label = groupExpression(groupBy);
  // Chronological for time buckets, biggest-first otherwise.
  const order =
    groupBy === 'year' || groupBy === 'month'
      ? Prisma.sql`ORDER BY "label" ASC`
      : Prisma.sql`ORDER BY "total" DESC, "label" ASC`;

  return prisma.$queryRaw<ReportRow[]>(Prisma.sql`
    SELECT ${label} AS "label", ${BUCKET_COLUMNS}
    ${assignmentFrom()}
    WHERE ${assignmentWhere(filters)}
    GROUP BY ${label}
    ${order}
    LIMIT 500
  `);
}

const CSV_COLUMNS: Array<[keyof ReportRow, string]> = [
  ['label', 'Group'],
  ['active', 'Active'],
  ['submitted', 'Submitted'],
  ['missed', 'Missed'],
  ['cancelled', 'Cancelled'],
  ['declined', 'Declined'],
  ['awarded', 'Awarded'],
  ['rejected', 'Rejected'],
  ['total', 'Total'],
  ['awardedAmount', 'Awarded amount'],
];

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote when the value contains a delimiter, quote or newline.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(rows: ReportRow[], groupBy: DashboardGroupBy) {
  const header = CSV_COLUMNS.map(([, heading]) =>
    heading === 'Group' ? `Group (${groupBy})` : heading
  );
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
