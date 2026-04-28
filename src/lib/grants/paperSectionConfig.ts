import { isGrantBackedPaperTypeCode } from '@/lib/grants/blueprintMetadata'
import {
  normalizeGrantCitationMode,
  requiresMappedGrantEvidence,
} from '@/lib/grants/citationMode'
import {
  buildGrantDraftingStrategyInput,
  resolveGrantDraftingStrategy,
  type GrantDraftingStrategyResolution,
} from '@/lib/grants/draftingStrategy'
import { isFeatureEnabled } from '@/lib/feature-flags'
import {
  isGrantSectionAutoDraftable,
  normalizeGrantWorkflowMode,
} from '@/lib/grants/workflowMode'
import type { GrantSectionSemantic, GrantTemplateIntent, GrantWorkflowMode } from '@/types/grant'

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
  workflowMode?: GrantWorkflowMode | string | null
  reviewerIntent?: string | null
  grantSemantic?: GrantSectionSemantic | string | null
  templateIntent?: GrantTemplateIntent | string | null
  suggestedCitationCount?: number | null
  authoritativePrepPointCount?: number | null
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
    workflowMode: normalizeGrantWorkflowMode(record.workflowMode, 'app_draft'),
    reviewerIntent: String(record.reviewerIntent || '').trim() || null,
    grantSemantic: String(record.grantSemantic || '').trim() || null,
    templateIntent: String(record.templateIntent || '').trim() || null,
    suggestedCitationCount: normalizeNullableNumber(record.suggestedCitationCount),
    authoritativePrepPointCount: normalizeNullableNumber(record.authoritativePrepPointCount),
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
  return resolveGrantBackedDraftingStrategy(section).mode
}

export function resolveGrantBackedDraftingStrategy(
  section: GrantBackedPaperSectionPlanItem | null | undefined
): GrantDraftingStrategyResolution {
  if (!section) {
    return { mode: 'one_pass', reason: 'section is not present in the grant-backed section plan.' }
  }

  if (isGrantBackedPass1BypassedSection(section.sectionKey)) {
    return { mode: 'one_pass', reason: 'reference-style sections bypass Generate Draft.' }
  }

  if (!isGrantSectionAutoDraftable({
    sectionType: section.sectionType || '',
    workflowMode: section.workflowMode || 'app_draft',
  })) {
    return { mode: 'one_pass', reason: 'section is not an app-draft narrative or short-answer section.' }
  }

  if (!isFeatureEnabled('ENABLE_TWO_PASS_GENERATION')) {
    return { mode: 'one_pass', reason: 'two-pass generation is disabled.' }
  }

  return resolveGrantDraftingStrategy(buildGrantDraftingStrategyInput({
    sectionKey: section.sectionKey,
    sectionType: section.sectionType,
    grantSemantic: section.grantSemantic,
    templateIntent: section.templateIntent,
    characterLimit: section.characterLimit,
    wordBudget: section.wordBudget,
    mustCover: section.mustCover,
    authoritativePrepPointCount: section.authoritativePrepPointCount,
    suggestedCitationCount: section.suggestedCitationCount,
  }))
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

export function resolveGrantBackedPass1Eligibility(
  paperTypeCode: unknown,
  sectionPlan: unknown,
  sectionKey: string
): {
  sectionKey: string
  displayLabel: string
  eligible: boolean
  mode: GrantBackedDraftingMode
  reason: string
} {
  const normalizedKey = normalizeGrantBackedSectionKey(sectionKey)

  if (!isGrantBackedPaperTypeCode(paperTypeCode)) {
    return {
      sectionKey: normalizedKey,
      displayLabel: formatGrantBackedSectionLabel(normalizedKey),
      eligible: false,
      mode: 'one_pass',
      reason: 'not a grant-backed paper type.',
    }
  }

  const section = getGrantBackedSectionPlanEntry(paperTypeCode, sectionPlan, normalizedKey)
  const strategy = resolveGrantBackedDraftingStrategy(section)

  return {
    sectionKey: normalizedKey,
    displayLabel: section?.displayLabel || formatGrantBackedSectionLabel(normalizedKey),
    eligible: strategy.mode === 'two_pass',
    mode: strategy.mode,
    reason: strategy.reason,
  }
}

export function isGrantBackedPass1EligibleSection(
  paperTypeCode: unknown,
  sectionPlan: unknown,
  sectionKey: string
): boolean {
  return resolveGrantBackedPass1Eligibility(paperTypeCode, sectionPlan, sectionKey).eligible
}

export function supportsGrantBackedDimensionFlow(
  paperTypeCode: unknown,
  sectionPlan: unknown,
  sectionKey: string
): boolean {
  return isGrantBackedPass1EligibleSection(paperTypeCode, sectionPlan, sectionKey)
}
