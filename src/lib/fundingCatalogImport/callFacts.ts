/**
 * The display facts of an imported call: where it came from, how fresh the
 * source is, its deadline stages, per-dimension eligibility and the award as
 * stated. Read-only; used by the call detail API.
 */
import prisma from '@/lib/prisma'
import { dimensionFromRow, type EligibilityDimension } from '@/lib/funding/eligibility'
import { countryNameFor } from '@/lib/geo/countries'

import { liveOpportunityStatus } from './lifecycle'

export interface ImportedCallFacts {
  source: { key: string; name: string; attribution: string | null; url: string | null; lastCheckedAt: string | null; available: boolean }
  enrichmentLevel: string | null
  opportunityStatus: string | null
  lifecycleNeedsCheck: boolean
  sourceClosedAt: string | null
  entryClosesAt: string | null
  finalDeadlineAt: string | null
  deadlines: Array<{ kind: string; label: string | null; dueDate: string; timezone: string | null }>
  award: {
    text: string | null
    currency: string | null
    min: number | null
    max: number | null
    timeBasis: string | null
    recipientBasis: string | null
    usdEstimateMin: number | null
    usdEstimateMax: number | null
    fxAsOf: string | null
    indirectCostPolicy: string | null
    indirectCostNote: string | null
  }
  eligibility: Array<{ dimension: 'residence' | 'citizenship' | 'host'; label: string; summary: string }>
  requiresNomination: boolean | null
  nominationNote: string | null
  requiredQualifications: string[]
  targetGroups: string[]
  membershipRequirements: string[]
  additionalBenefits: string[]
  sdgGoals: number[]
  programmeFramework: string | null
  titleNative: string | null
}

const DIMENSION_LABEL = { residence: 'Applicants based in', citizenship: 'Citizenship', host: 'Work carried out in' } as const

function summarize(dimension: EligibilityDimension): string | null {
  if (!dimension.scope) return null
  if (dimension.scope === 'ANY') return dimension.regionCodes.includes('ONLINE') ? 'Any country (online)' : 'Any country'
  if (dimension.scope === 'UNSPECIFIED') return 'Not stated — check the official page'
  const names = dimension.countryCodes.map(countryNameFor)
  const regions = dimension.regionCodes.filter((code) => code !== 'ONLINE').map((code) => code.replace(/_/g, ' ').toLowerCase())
  const head = regions.length > 0 ? `${regions.join(', ')}${names.length > 0 ? ': ' : ''}` : ''
  if (names.length === 0) return `${head || 'Listed regions'} (member list not stated)`
  return `${head}${names.slice(0, 12).join(', ')}${names.length > 12 ? ` and ${names.length - 12} more` : ''}`
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null)
const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null)

export async function buildImportedCallFacts(call: Record<string, any>): Promise<ImportedCallFacts> {
  const [record, deadlines] = await Promise.all([
    prisma.externalSourceRecord.findFirst({
      where: { funding_call_id: call.id, entity_type: 'CALL', link_role: 'PRIMARY' },
      select: { source_key: true, source_url: true, last_seen_at: true, availability: true, source_checked_at: true },
    }),
    prisma.fundingCallDeadline.findMany({ where: { funding_call_id: call.id }, orderBy: { due_date: 'asc' } }),
  ])
  const registry = record
    ? await prisma.fundingSourceRegistry.findUnique({ where: { source_key: record.source_key } })
    : null
  const eligibility: ImportedCallFacts['eligibility'] = []
  for (const dimension of ['residence', 'citizenship', 'host'] as const) {
    const summary = summarize(dimensionFromRow(call, dimension))
    if (summary) eligibility.push({ dimension, label: DIMENSION_LABEL[dimension], summary })
  }
  return {
    source: {
      key: record?.source_key || 'external',
      name: registry?.display_name || record?.source_key || 'External source',
      attribution: registry?.attribution_text || null,
      url: record?.source_url || null,
      // When the source last checked its page (not when we imported it).
      lastCheckedAt: iso(record?.source_checked_at) || iso(record?.last_seen_at),
      available: (record?.availability || 'AVAILABLE') === 'AVAILABLE',
    },
    enrichmentLevel: call.enrichment_level || null,
    // Computed now: the stored status is an import-time cache and goes stale.
    opportunityStatus: liveOpportunityStatus(call),
    lifecycleNeedsCheck: Boolean(call.lifecycle_needs_check),
    sourceClosedAt: iso(call.source_closed_at),
    entryClosesAt: day(call.entry_closes_at),
    finalDeadlineAt: day(call.final_deadline_at),
    deadlines: deadlines.map((d) => ({ kind: d.kind, label: d.label, dueDate: d.due_date.toISOString().slice(0, 10), timezone: d.due_timezone })),
    award: {
      text: call.amount_text || null,
      currency: call.currency_code || null,
      min: call.amount_min ?? null,
      max: call.amount_max ?? null,
      timeBasis: call.amount_time_basis || null,
      recipientBasis: call.amount_recipient_basis || null,
      usdEstimateMin: call.amount_min_usd_est ?? null,
      usdEstimateMax: call.amount_max_usd_est ?? null,
      fxAsOf: day(call.fx_as_of),
      indirectCostPolicy: call.indirect_cost_policy || null,
      indirectCostNote: call.indirect_cost_note || null,
    },
    eligibility,
    requiresNomination: call.requires_nomination ?? null,
    nominationNote: call.nomination_note || null,
    requiredQualifications: call.required_qualifications || [],
    targetGroups: call.target_groups || [],
    membershipRequirements: call.membership_requirements || [],
    additionalBenefits: call.additional_benefits || [],
    sdgGoals: call.sdg_goals || [],
    programmeFramework: call.programme_framework || null,
    titleNative: call.title_native || null,
  }
}
