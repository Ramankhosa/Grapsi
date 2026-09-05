/**
 * The proposal register, as a spreadsheet.
 *
 * This is the artefact the office is asked for by name — at an audit, at a
 * governing-body meeting, at the end of a financial year. It is deliberately
 * flat and wide: one row per application, every column somebody has asked for,
 * no nesting, so it opens in Excel and can be sorted and pivoted without
 * anybody needing this system.
 */
import prisma from '@/lib/prisma'
import { getReportingPeriod } from '@/lib/tenant/reportingPeriod'

import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from './shared'

export interface RegisterRow {
  school: string
  department: string
  pi: string
  employeeId: string
  designation: string
  title: string
  agency: string
  scheme: string
  status: string
  versions: number
  lastScore: string
  reviewsShared: number
  cutoff: string
  agencyDeadline: string
  clearedOn: string
  submittedOn: string
  reference: string
  requested: string
  sanctioned: string
  currency: string
  sanctionOrder: string
  coInvestigators: string
  createdOn: string
}

const COLUMNS: Array<[keyof RegisterRow, string]> = [
  ['school', 'School'],
  ['department', 'Department'],
  ['pi', 'Principal Investigator'],
  ['employeeId', 'Employee ID'],
  ['designation', 'Designation'],
  ['title', 'Proposal title'],
  ['agency', 'Agency'],
  ['scheme', 'Scheme'],
  ['status', 'Status'],
  ['versions', 'Drafts'],
  ['lastScore', 'Last review score'],
  ['reviewsShared', 'Reviews shared'],
  ['cutoff', 'Internal cut-off'],
  ['agencyDeadline', 'Agency deadline'],
  ['clearedOn', 'Cleared on'],
  ['submittedOn', 'Submitted on'],
  ['reference', 'Reference'],
  ['requested', 'Amount requested'],
  ['sanctioned', 'Amount sanctioned'],
  ['currency', 'Currency'],
  ['sanctionOrder', 'Sanction order'],
  ['coInvestigators', 'Co-investigators'],
  ['createdOn', 'Opened on'],
]

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  // Excel reads a leading =, +, - or @ as a formula, so a title starting with
  // one would execute rather than display. Prefix it out of harm's way.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

function isoDate(value: Date | null | undefined): string {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

export interface RegisterInput {
  tenantId: string
  /** null means every school. */
  reachUnitIds: string[] | null
  status?: string[] | null
  orgUnitId?: string | null
  window?: string | null
}

export async function buildRegisterRows(input: RegisterInput): Promise<RegisterRow[]> {
  const where: any = { tenant_id: input.tenantId }
  const and: any[] = []

  if (input.reachUnitIds) {
    and.push({ org_unit_id: { in: input.reachUnitIds.length ? input.reachUnitIds : ['__none__'] } })
  }
  if (input.status?.length) and.push({ status: { in: input.status } })
  if (input.orgUnitId) and.push({ org_unit_id: input.orgUnitId })
  if (input.window === 'reporting') {
    const period = await getReportingPeriod(input.tenantId)
    and.push({ created_at: { gte: period.start, lte: period.end } })
  }
  if (and.length) where.AND = and

  const rows = await prisma.grantProposal.findMany({
    where,
    orderBy: [{ org_unit_id: 'asc' }, { created_at: 'desc' }],
    include: {
      org_unit: { select: { name: true } },
      pi_org_unit: { select: { name: true } },
      pi: {
        select: {
          name: true,
          email: true,
          researcher_profile: { select: { employee_id: true, designation: true } },
        },
      },
      team: {
        where: { role: { not: 'PI' } },
        select: { name: true, role: true, is_external: true },
        orderBy: { sort_order: 'asc' },
      },
      versions: { select: { id: true } },
      reviews: {
        where: { shared_at: { not: null } },
        orderBy: { shared_at: 'desc' },
        select: { overall_score: true },
      },
    },
  })

  return rows.map((row) => ({
    school: row.org_unit?.name || '',
    department: row.pi_org_unit?.name || '',
    pi: row.pi?.name || row.pi?.email || '',
    employeeId: row.pi?.researcher_profile?.employee_id || '',
    designation: row.pi?.researcher_profile?.designation || '',
    title: row.title,
    agency: row.agency_name,
    scheme: row.scheme_title || '',
    status: PROPOSAL_STATUS_LABELS[row.status as ProposalStatus] || row.status,
    versions: row.versions.length,
    lastScore:
      row.reviews[0]?.overall_score != null ? row.reviews[0].overall_score.toFixed(1) : '',
    reviewsShared: row.reviews.length,
    cutoff: isoDate(row.review_cutoff_at),
    agencyDeadline: isoDate(row.agency_deadline_at),
    clearedOn: isoDate(row.cleared_at),
    submittedOn: isoDate(row.submitted_at),
    reference: row.submission_reference || '',
    requested: row.requested_amount != null ? String(row.requested_amount) : '',
    sanctioned: row.sanctioned_amount != null ? String(row.sanctioned_amount) : '',
    currency: row.currency,
    sanctionOrder: row.sanction_reference || '',
    coInvestigators: row.team
      .map((member) => `${member.name}${member.is_external ? ' (external)' : ''}`)
      .join('; '),
    createdOn: isoDate(row.created_at),
  }))
}

export function registerToCsv(rows: RegisterRow[]): string {
  const lines = [COLUMNS.map(([, heading]) => csvCell(heading)).join(',')]
  for (const row of rows) {
    lines.push(COLUMNS.map(([key]) => csvCell(row[key])).join(','))
  }
  return lines.join('\r\n')
}
