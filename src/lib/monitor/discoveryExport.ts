import { writeTables, type ExportTable } from '@/lib/fundingDept/managementExport'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/prisma-generated'

import { OUTCOME_STYLES } from '@/components/funding/monitor/outcome'

import { lifecycleAt } from './evidence'
import { classifyOpportunity } from './outcomes'

/** The Review lanes, as database filters. The list screen and the export share them. */
export function laneWhere(lane: string): Prisma.MonitorOpportunityWhereInput {
  if (lane === 'ALL') return {}
  if (lane === 'WAITING_LOCAL') return { triage_reason: { startsWith: 'Waiting for laptop' } }
  if (lane === 'NEEDS_EVIDENCE') return { processing_state: 'NEEDS_EVIDENCE' }
  if (lane === 'AUDIT') return { triage_verdict: 'NOT_FUNDING' }
  return { review_state: lane }
}

export const LANE_LABELS: Record<string, string> = {
  PENDING: 'To review', WAITING_LOCAL: 'Waiting for laptop', NEEDS_EVIDENCE: 'Needs evidence', UPDATE_PROPOSED: 'Updates',
  PUBLISHED: 'Published', REJECTED: 'Rejected', SNOOZED: 'Snoozed', AUDIT: 'Screened out', ALL: 'All',
}

/** Most rows one workbook holds; the sheet says when there were more. */
export const EXPORT_CAP = 5000

type Fields = Record<string, { value: unknown; status?: string }>

const asText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('; ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '')

function amount(fields: Fields) {
  const min = fields.amount_min?.value
  const max = fields.amount_max?.value
  const currency = asText(fields.currency?.value)
  if (min == null && max == null) return ''
  const range = min != null && max != null && min !== max ? `${min}–${max}` : asText(max ?? min)
  return currency ? `${range} ${currency}` : range
}

const COLUMNS = [
  'Result', 'Title', 'Funder', 'Website', 'Call page', 'Deadline', 'Opens', 'Rolling', 'Award', 'Funding kinds', 'Eligible countries',
  'Lifecycle', 'Review state', 'AI verdict', 'AI confidence', 'AI reason', 'Catalogue call', 'Catalogue status',
  'Found', 'Updated', 'Page last checked', 'Page status', 'Your decision', 'Reviewer notes', 'Discovery id',
]

/**
 * A workbook of discoveries for manual review: one row per opportunity with
 * its result (the same classifier as the screen), the facts the AI drafted,
 * and empty "Your decision" / "Reviewer notes" columns to fill in offline.
 */
export async function discoveryWorkbook(lane: string, generatedBy: string, now = new Date()) {
  const where = laneWhere(lane)
  const [total, rows] = await Promise.all([
    prisma.monitorOpportunity.count({ where }),
    prisma.monitorOpportunity.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: EXPORT_CAP,
      include: {
        site: { select: { host: true, display_name: true } },
        funder: { select: { name: true } },
        primary_resource: { select: { canonical_url: true, last_validated_at: true, last_validation_status: true } },
        funding_call: { select: { id: true, title: true, catalog_status: true } },
      },
    }),
  ])
  const sheet: unknown[][] = [COLUMNS]
  const tally = new Map<string, number>()
  for (const row of rows) {
    const fields = ((row.field_evidence as { payload?: { fields?: Fields } } | null)?.payload?.fields ?? {}) as Fields
    const { outcome, detail } = classifyOpportunity(row, row.primary_resource)
    const label = OUTCOME_STYLES[outcome].label
    tally.set(label, (tally.get(label) ?? 0) + 1)
    sheet.push([
      label,
      row.title || asText(fields.scheme_title?.value),
      row.funder?.name || asText(fields.agency_name?.value) || row.site.display_name || '',
      row.site.host,
      row.primary_resource?.canonical_url ?? '',
      asText(fields.close_date?.value),
      asText(fields.open_date?.value),
      asText(fields.is_rolling?.value),
      amount(fields),
      asText(fields.funding_kinds?.value),
      asText(fields.eligible_countries?.value),
      lifecycleAt(fields.close_date?.value as string | null, fields.open_date?.value as string | null, row.lifecycle).toLowerCase(),
      row.review_state.toLowerCase().replace(/_/g, ' '),
      (row.triage_verdict ?? '').toLowerCase().replace(/_/g, ' '),
      typeof row.triage_confidence === 'number' ? Math.round(row.triage_confidence * 100) / 100 : '',
      row.triage_reason ?? detail,
      row.funding_call?.title ?? '',
      row.funding_call?.catalog_status ?? '',
      iso(row.created_at),
      iso(row.updated_at),
      iso(row.primary_resource?.last_validated_at),
      row.primary_resource?.last_validation_status ?? '',
      '',
      '',
      row.id,
    ])
  }
  const about: ExportTable = {
    name: 'About',
    rows: [
      ['Source Watch discoveries for manual review'],
      ['Lane', LANE_LABELS[lane] ?? lane],
      ['Generated', `${iso(now)} UTC`],
      ['Generated by', generatedBy],
      ['Rows', rows.length],
      ...(total > rows.length ? [['Note', `${total} discoveries match; this file holds the ${rows.length} updated most recently.`]] : []),
      [],
      ['Result', 'Rows'],
      ...[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]),
      [],
      ['Columns'],
      ['Result', 'Same colour-coded result as the screen: Funding found = a call was found and sent for review; Published = it reached the catalogue.'],
      ['Deadline, Opens, Award…', 'Drafted by the AI from the official page; check them against the page before publishing.'],
      ['Your decision, Reviewer notes', 'Left empty for you. Decisions are made in Source Watch → Review; this file does not change anything.'],
    ],
  }
  return writeTables([about, { name: 'Opportunities', rows: sheet }], 'xlsx')
}
