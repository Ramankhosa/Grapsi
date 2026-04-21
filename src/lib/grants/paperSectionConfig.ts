import { isGrantBackedPaperTypeCode } from '@/lib/grants/blueprintMetadata'
import {
  normalizeGrantCitationMode,
  requiresMappedGrantEvidence,
} from '@/lib/grants/citationMode'
import type { GrantSectionSemantic } from '@/types/grant'

export type GrantBackedSectionType =
  | 'narrative'
  | 'short_answer'
  | 'checklist'
  | 'table'
  | 'budget_rows'

export interface GrantBackedPaperSectionPlanItem {
  sectionKey: string
  purpose?: string
  mustCover?: string[]
  citationMode?: 'mapped_evidence' | 'direct_draft' | 'no_citations'
  displayLabel?: string | null
  required?: boolean
  wordBudget?: number | null
  characterLimit?: number | null
  sectionType?: GrantBackedSectionType | null
  reviewerIntent?: string | null
  grantSemantic?: GrantSectionSemantic | string | null
}

export type GrantBackedDraftingMode = 'one_pass' | 'two_pass'

const GRANT_PASS1_BYPASS_SECTION_KEYS = new Set(['references', 'reference', 'bibliography'])

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeGrantBackedSectionKey(sectionKey: string): string {
  return String(sectionKey || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function formatGrantBackedSectionLabel(sectionKey: string): string {
  return normalizeGrantBackedSectionKey(sectionKey)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

function normalizeNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function normalizeGrantBackedSectionPlanItem(
  value: unknown
): GrantBackedPaperSectionPlanItem | null {
  const record = asObject(value)
  const sectionKey = normalizeGrantBackedSectionKey(String(record.sectionKey || ''))
  if (!sectionKey) return null

  return {
    sectionKey,
    purpose: String(record.purpose || '').trim() || undefined,
    mustCover: normalizeStringArray(record.mustCover),
    citationMode: normalizeGrantCitationMode(record.citationMode, {
      sectionType: String(record.sectionType || '').trim() || null,
      workflowMode: String(record.workflowMode || '').trim() || null,
      suggestedCitationCount: normalizeNullableNumber(record.suggestedCitationCount),
    }),
    displayLabel: String(record.displayLabel || record.label || '').trim() || null,
    required: record.required === true,
    wordBudget: normalizeNullableNumber(record.wordBudget),
    characterLimit: normalizeNullableNumber(record.characterLimit),
    sectionType: String(record.sectionType || '').trim()
      ? (String(record.sectionType || '').trim() as GrantBackedSectionType)
      : null,
    reviewerIntent: String(record.reviewerIntent || '').trim() || null,
    grantSemantic: String(record.grantSemantic || '').trim() || null,
  }
}

export function getGrantBackedSectionPlan(
  paperTypeCode: unknown,
  sectionPlan: unknown
): GrantBackedPaperSectionPlanItem[] {
  if (!isGrantBackedPaperTypeCode(paperTypeCode) || !Array.isArray(sectionPlan)) {
    return []
  }

  return sectionPlan
    .map((item) => normalizeGrantBackedSectionPlanItem(item))
    .filter((item): item is GrantBackedPaperSectionPlanItem => Boolean(item))
}

export function getGrantBackedSectionPlanEntry(
  paperTypeCode: unknown,
  sectionPlan: unknown,
  sectionKey: string
): GrantBackedPaperSectionPlanItem | null {
  const normalizedKey = normalizeGrantBackedSectionKey(sectionKey)
  return (
    getGrantBackedSectionPlan(paperTypeCode, sectionPlan).find(
      (entry) => entry.sectionKey === normalizedKey
    ) || null
  )
}

export function resolveGrantBackedDraftingMode(
  section: GrantBackedPaperSectionPlanItem | null | undefined
): GrantBackedDraftingMode {
  if (!section) return 'two_pass'

  const dimensionCount = Array.isArray(section.mustCover) ? section.mustCover.length : 0
  if (section.sectionType === 'short_answer') return 'one_pass'
  if (section.grantSemantic === 'summary') return 'one_pass'
  if (typeof section.characterLimit === 'number' && section.characterLimit > 0 && section.characterLimit <= 1500) {
    return 'one_pass'
  }
  if (typeof section.wordBudget === 'number' && section.wordBudget > 0 && section.wordBudget <= 250) {
    return 'one_pass'
  }
  if (
    section.sectionType === 'narrative'
    || dimensionCount >= 3
    || (typeof section.wordBudget === 'number' && section.wordBudget >= 350)
  ) {
    return 'two_pass'
  }
  return 'one_pass'
}

export function buildGrantBackedSectionConfigs(
  paperTypeCode: unknown,
  sectionPlan: unknown
): Array<{
  keys: string[]
  label: string
  description?: string
  required?: boolean
  wordLimit?: number
}> {
  return getGrantBackedSectionPlan(paperTypeCode, sectionPlan).map((section) => ({
    keys: [section.sectionKey],
    label: section.displayLabel || formatGrantBackedSectionLabel(section.sectionKey),
    ...(section.purpose ? { description: section.purpose } : {}),
    required: section.required === true,
    ...(typeof section.wordBudget === 'number' && section.wordBudget > 0
      ? { wordLimit: section.wordBudget }
      : {}),
  }))
}

export function buildGrantBackedCitationEligibility(
  paperTypeCode: unknown,
  sectionPlan: unknown
): Record<string, boolean> {
  return Object.fromEntries(
    getGrantBackedSectionPlan(paperTypeCode, sectionPlan).map((section) => [
      section.sectionKey,
      requiresMappedGrantEvidence(section.citationMode),
    ])
  )
}

export function isGrantBackedSinglePassSection(
  paperTypeCode: unknown,
  sectionPlan: unknown,
  sectionKey: string
): boolean {
  const section = getGrantBackedSectionPlanEntry(paperTypeCode, sectionPlan, sectionKey)
  return resolveGrantBackedDraftingMode(section) === 'one_pass'
}

export function isGrantBackedPass1BypassedSection(sectionKey: string): boolean {
  return GRANT_PASS1_BYPASS_SECTION_KEYS.has(normalizeGrantBackedSectionKey(sectionKey))
}

export function supportsGrantBackedDimensionFlow(
  paperTypeCode: unknown,
  sectionPlan: unknown,
  sectionKey: string
): boolean {
  return !isGrantBackedPass1BypassedSection(sectionKey)
    && !isGrantBackedSinglePassSection(paperTypeCode, sectionPlan, sectionKey)
}
