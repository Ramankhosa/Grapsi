import { Prisma } from '@prisma/client';

import prisma from '../prisma';

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
 * Cancelled assignments are deliberately excluded from all three buckets; they
 * are reported separately so they never inflate a "missed" figure.
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
  | 'faculty'
  | 'year'
  | 'month';

export const DASHBOARD_GROUP_BY: DashboardGroupBy[] = [
  'agency',
  'call',
  'school',
  'department',
  'faculty',
  'year',
  'month',
];

export interface DashboardFilters {
  tenantId: string;
  /** Department org-unit ids. A School selection expands to its departments. */
  orgUnitIds?: string[];
  /** Filters on the assignment's creation date. */
  dateFrom?: Date | null;
  dateTo?: Date | null;
  agency?: string | null;
}

/** Open = the work is still live (not completed, not cancelled). */
const OPEN_STATUSES = Prisma.sql`ca.status IN ('ASSIGNED', 'IN_PROGRESS')`;

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

  const orgUnitIds = (filters.orgUnitIds || []).filter(Boolean);
  if (orgUnitIds.length > 0) {
    conditions.push(
      Prisma.sql`rp.org_unit_id = ANY(ARRAY[${Prisma.join(
        orgUnitIds.map((id) => Prisma.sql`${id}`)
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
  `;
}

const BUCKET_COLUMNS = Prisma.sql`
  COUNT(*) FILTER (WHERE ${IS_ACTIVE})::int    AS "active",
  COUNT(*) FILTER (WHERE ${IS_SUBMITTED})::int AS "submitted",
  COUNT(*) FILTER (WHERE ${IS_MISSED})::int    AS "missed",
  COUNT(*) FILTER (WHERE ca.status = 'CANCELLED')::int      AS "cancelled",
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

  const unassignedExpiredCalls = await countUnassignedExpiredCalls(filters.tenantId);
  const decided = (row?.awarded || 0) + (row?.rejected || 0);

  return {
    active: row?.active || 0,
    submitted: row?.submitted || 0,
    missed: row?.missed || 0,
    cancelled: row?.cancelled || 0,
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
      fc."tenantId" = ${tenantId}
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

export interface ReportRow {
  label: string;
  active: number;
  submitted: number;
  missed: number;
  cancelled: number;
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
    case 'faculty':
      return Prisma.sql`COALESCE(rp.display_name, u.name, u.email, 'Unknown')`;
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
